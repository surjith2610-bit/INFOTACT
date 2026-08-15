import io
import random
import uuid
from datetime import datetime, timedelta, timezone
import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File

from app.database import neo4j_conn
from app.services.kafka_producer import publish_transaction
from app.services.detection import (
    run_all_detections,
    get_graph_sample,
    detect_smurfing,
    detect_circular_transfers,
    detect_high_frequency,
    detect_large_transaction,
)

router = APIRouter(prefix="/api", tags=["api"])

REQUIRED_COLUMNS = {"sender_account", "receiver_account", "amount"}


def _load_dataframe_to_graph(df: pd.DataFrame) -> int:
    """Ingests transaction DataFrame into Neo4j using MERGE Cypher queries."""
    count = 0
    for _, row in df.iterrows():
        tx_id = str(row.get("transaction_id", uuid.uuid4()))
        sender = str(row["sender_account"]).strip()
        receiver = str(row["receiver_account"]).strip()
        amount = float(row["amount"])
        timestamp = str(row.get("timestamp", datetime.now(timezone.utc).isoformat()))
        sender_ip = str(row.get("sender_ip", "")).strip() or None
        receiver_ip = str(row.get("receiver_ip", "")).strip() or None

        params = {
            "txId": tx_id,
            "sender": sender,
            "receiver": receiver,
            "amount": amount,
            "timestamp": timestamp,
            "senderIp": sender_ip,
            "receiverIp": receiver_ip,
        }

        cypher = """
        MERGE (s:Account {accountId: $sender})
        MERGE (r:Account {accountId: $receiver})
        MERGE (s)-[t:TRANSFER {txId: $txId}]->(r)
        ON CREATE SET t.amount = $amount, t.timestamp = $timestamp
        FOREACH (_ IN CASE WHEN $senderIp IS NOT NULL THEN [1] ELSE [] END |
            MERGE (ip1:IP {address: $senderIp}) MERGE (s)-[:USED_IP]->(ip1))
        FOREACH (_ IN CASE WHEN $receiverIp IS NOT NULL THEN [1] ELSE [] END |
            MERGE (ip2:IP {address: $receiverIp}) MERGE (r)-[:USED_IP]->(ip2))
        """
        neo4j_conn.run(cypher, params)
        publish_transaction(params)
        count += 1
    return count


@router.get("/stats")
async def get_stats():
    """System-wide summary metrics for dashboard cards."""
    cypher_counts = """
    MATCH (a:Account) WITH count(a) AS accountCount
    MATCH ()-[t:TRANSFER]->() WITH accountCount, count(t) AS txCount
    OPTIONAL MATCH (fa:FraudAlert) WITH accountCount, txCount, count(fa) AS alertCount
    OPTIONAL MATCH (faHigh:FraudAlert) WHERE faHigh.severity IN ['HIGH', 'CRITICAL'] WITH accountCount, txCount, alertCount, count(faHigh) AS highSeverityCount
    RETURN accountCount, txCount, alertCount, highSeverityCount
    """
    try:
        res = neo4j_conn.run(cypher_counts)
        stats_data = res[0] if res else {"accountCount": 0, "txCount": 0, "alertCount": 0, "highSeverityCount": 0}
    except Exception as e:
        stats_data = {"accountCount": 0, "txCount": 0, "alertCount": 0, "highSeverityCount": 0, "error": str(e)}

    cypher_dist = """
    MATCH (fa:FraudAlert)
    RETURN fa.type AS type, count(fa) AS count
    """
    try:
        dist_res = neo4j_conn.run(cypher_dist)
        distribution = {r["type"]: r["count"] for r in dist_res}
    except Exception:
        distribution = {}

    return {
        "status": "ok",
        "total_accounts": stats_data.get("accountCount", 0),
        "total_transactions": stats_data.get("txCount", 0),
        "fraud_alerts": stats_data.get("alertCount", 0),
        "high_severity_alerts": stats_data.get("highSeverityCount", 0),
        "fraud_type_distribution": distribution,
        "database": "connected",
    }


@router.get("/accounts")
async def get_accounts(limit: int = 100):
    """Retrieves account entities stored in the graph."""
    cypher = """
    MATCH (a:Account)
    OPTIONAL MATCH (a)-[out:TRANSFER]->()
    OPTIONAL MATCH ()-[in:TRANSFER]->(a)
    RETURN a.accountId AS id,
           a.name AS name,
           coalesce(a.riskScore, 0.0) AS risk_score,
           count(DISTINCT out) AS outbound_count,
           count(DISTINCT in) AS inbound_count
    ORDER BY risk_score DESC, inbound_count DESC
    LIMIT $limit
    """
    return neo4j_conn.run(cypher, {"limit": limit})


@router.get("/transactions")
async def get_transactions(limit: int = 100):
    """Retrieves recent transactions from the graph."""
    cypher = """
    MATCH (s:Account)-[t:TRANSFER]->(r:Account)
    RETURN t.txId AS id,
           s.accountId AS sender,
           r.accountId AS receiver,
           t.amount AS amount,
           t.timestamp AS timestamp
    ORDER BY t.timestamp DESC
    LIMIT $limit
    """
    return neo4j_conn.run(cypher, {"limit": limit})


@router.get("/fraud-alerts")
async def get_fraud_alerts(limit: int = 100):
    """Retrieves stored fraud alerts from Neo4j."""
    cypher = """
    MATCH (fa:FraudAlert)
    OPTIONAL MATCH (fa)-[:INVOLVES]->(a:Account)
    RETURN fa.id AS id,
           fa.type AS type,
           fa.severity AS severity,
           fa.description AS description,
           fa.createdAt AS timestamp,
           collect(DISTINCT a.accountId) AS account_ids,
           coalesce(fa.transactionIds, []) AS transaction_ids
    ORDER BY fa.createdAt DESC
    LIMIT $limit
    """
    return neo4j_conn.run(cypher, {"limit": limit})


@router.get("/fraud-alerts/{alert_id}")
async def get_fraud_alert_detail(alert_id: str):
    """Retrieves specific fraud alert details by ID."""
    cypher = """
    MATCH (fa:FraudAlert {id: $alertId})
    OPTIONAL MATCH (fa)-[:INVOLVES]->(a:Account)
    RETURN fa.id AS id,
           fa.type AS type,
           fa.severity AS severity,
           fa.description AS description,
           fa.createdAt AS timestamp,
           collect(DISTINCT a.accountId) AS account_ids,
           coalesce(fa.transactionIds, []) AS transaction_ids
    """
    res = neo4j_conn.run(cypher, {"alertId": alert_id})
    if not res:
        raise HTTPException(status_code=404, detail="Fraud alert not found")
    return res[0]


@router.get("/graph")
async def get_graph(limit: int = 300):
    """Returns force-directed graph node and edge payload."""
    return get_graph_sample(limit)


@router.post("/fraud/detect")
async def execute_fraud_detection():
    """Executes all fraud detection rules and updates graph alert state."""
    return run_all_detections()


@router.post("/data/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    """Uploads transaction CSV into the Neo4j graph database."""
    raw = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse file as CSV.")

    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {', '.join(missing)}",
        )

    inserted = _load_dataframe_to_graph(df)
    return {
        "message": f"Successfully ingested {inserted} transaction records into graph.",
        "rows": inserted,
        "columns": list(df.columns),
    }


@router.post("/data/generate")
async def generate_synthetic(
    normal_accounts: int = 40,
    normal_transactions: int = 150,
    inject_smurfing_ring: bool = True,
):
    """Generates synthetic dataset with optional planted smurfing syndicate."""
    rows = []
    accounts = [f"ACC{i:04d}" for i in range(normal_accounts)]

    for _ in range(normal_transactions):
        sender, receiver = random.sample(accounts, 2)
        rows.append(
            {
                "transaction_id": f"tx-gen-{uuid.uuid4().hex[:8]}",
                "sender_account": sender,
                "receiver_account": receiver,
                "amount": round(random.uniform(20.0, 4800.0), 2),
                "timestamp": (
                    datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 1440))
                ).isoformat(),
                "sender_ip": f"10.0.{random.randint(0,255)}.{random.randint(0,255)}",
                "receiver_ip": f"10.0.{random.randint(0,255)}.{random.randint(0,255)}",
            }
        )

    if inject_smurfing_ring:
        shell_account = "SHELL_OFFSHORE_01"
        smurf_senders = [f"SMURF{i:03d}" for i in range(12)]
        shared_ip = "185.220.101.7"
        for sender in smurf_senders:
            rows.append(
                {
                    "transaction_id": f"tx-smurf-{uuid.uuid4().hex[:8]}",
                    "sender_account": sender,
                    "receiver_account": shell_account,
                    "amount": round(random.uniform(9500.0, 9950.0), 2),
                    "timestamp": (
                        datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 60))
                    ).isoformat(),
                    "sender_ip": shared_ip,
                    "receiver_ip": "45.33.12.99",
                }
            )

    df = pd.DataFrame(rows)
    inserted = _load_dataframe_to_graph(df)
    return {
        "message": f"Generated {inserted} synthetic transactions with planted syndicate ring.",
        "rows": inserted,
    }
