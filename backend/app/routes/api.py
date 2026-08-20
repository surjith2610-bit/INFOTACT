import io
import random
import uuid
import logging
from datetime import datetime, timedelta, timezone
import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File

from app.database import neo4j_conn
from app.services.kafka_producer import publish_transaction
from app.services.store import memory_store
from app.services.detection import (
    run_all_detections,
    get_graph_sample,
    detect_smurfing,
    detect_circular_transfers,
    detect_high_frequency,
    detect_large_transaction,
)

logger = logging.getLogger("api")
router = APIRouter(prefix="/api", tags=["api"])

REQUIRED_COLUMNS = {"sender_account", "receiver_account", "amount"}


def _normalize_dataframe_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Normalizes column headers from various CSV formats (IBM AML, PaySim, Kaggle, custom)."""
    # Strip whitespace & BOM characters from column names
    df.columns = [str(c).strip().replace('\ufeff', '') for c in df.columns]

    col_map = {}
    lower_cols = {c.lower(): c for c in df.columns}

    sender_candidates = ["sender_account", "sender", "nameorig", "from", "source", "account_from", "accountfrom", "sender_id", "senderaccount", "fromaccount"]
    receiver_candidates = ["receiver_account", "receiver", "namedest", "to", "destination", "account_to", "accountto", "receiver_id", "receiveraccount", "toaccount"]
    amount_candidates = ["amount", "tx_amount", "val", "value", "transaction_amount", "amt"]
    tx_id_candidates = ["transaction_id", "tx_id", "txid", "id", "transactionid", "step"]
    timestamp_candidates = ["timestamp", "time", "date", "datetime", "created_at"]
    sender_ip_candidates = ["sender_ip", "senderip", "ip_src", "ip_sender", "src_ip"]
    receiver_ip_candidates = ["receiver_ip", "receiverip", "ip_dst", "ip_receiver", "dst_ip"]

    for cand in sender_candidates:
        if cand in lower_cols:
            col_map[lower_cols[cand]] = "sender_account"
            break

    for cand in receiver_candidates:
        if cand in lower_cols:
            col_map[lower_cols[cand]] = "receiver_account"
            break

    for cand in amount_candidates:
        if cand in lower_cols:
            col_map[lower_cols[cand]] = "amount"
            break

    for cand in tx_id_candidates:
        if cand in lower_cols:
            col_map[lower_cols[cand]] = "transaction_id"
            break

    for cand in timestamp_candidates:
        if cand in lower_cols:
            col_map[lower_cols[cand]] = "timestamp"
            break

    for cand in sender_ip_candidates:
        if cand in lower_cols:
            col_map[lower_cols[cand]] = "sender_ip"
            break

    for cand in receiver_ip_candidates:
        if cand in lower_cols:
            col_map[lower_cols[cand]] = "receiver_ip"
            break

    if col_map:
        df = df.rename(columns=col_map)

    return df


def _clean_amount(val) -> float:
    """Parses numeric amount values safely from float, int, or currency string."""
    if pd.isna(val):
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    val_str = str(val).replace("$", "").replace(",", "").strip()
    try:
        return float(val_str)
    except ValueError:
        return 0.0


def _load_dataframe_to_graph(df: pd.DataFrame) -> int:
    """Ingests transaction DataFrame into Neo4j & In-Memory Store."""
    df = _normalize_dataframe_columns(df)
    count = 0

    for _, row in df.iterrows():
        tx_id = str(row.get("transaction_id", f"tx-{uuid.uuid4().hex[:8]}"))
        sender = str(row["sender_account"]).strip()
        receiver = str(row["receiver_account"]).strip()
        amount = _clean_amount(row["amount"])
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

        # 1. Update Neo4j graph
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

        # 2. Update In-Memory Store
        memory_store.add_transaction({
            "id": tx_id,
            "sender": sender,
            "receiver": receiver,
            "amount": amount,
            "timestamp": timestamp,
            "sender_ip": sender_ip,
            "receiver_ip": receiver_ip,
        })

        # 3. Stream to Kafka (non-blocking if offline)
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
    stats_data = None
    try:
        res = neo4j_conn.run(cypher_counts)
        if res and res[0].get("accountCount", 0) > 0:
            stats_data = res[0]
    except Exception as e:
        logger.warning(f"Stats Cypher exception: {e}")

    # Memory store fallback if Neo4j is empty / offline
    if not stats_data or stats_data.get("accountCount", 0) == 0:
        mem_accs = memory_store.get_accounts(10000)
        mem_txs = memory_store.get_transactions(10000)
        mem_alerts = memory_store.get_alerts(1000)
        mem_high = [a for a in mem_alerts if a.get("severity") in ["HIGH", "CRITICAL"]]

        stats_data = {
            "accountCount": len(mem_accs),
            "txCount": len(mem_txs),
            "alertCount": len(mem_alerts),
            "highSeverityCount": len(mem_high),
        }

    # Fraud type distribution
    distribution = {}
    try:
        cypher_dist = "MATCH (fa:FraudAlert) RETURN fa.type AS type, count(fa) AS count"
        dist_res = neo4j_conn.run(cypher_dist)
        if dist_res:
            distribution = {r["type"]: r["count"] for r in dist_res}
    except Exception:
        pass

    if not distribution:
        for a in memory_store.get_alerts(1000):
            t = a.get("type", "UNKNOWN")
            distribution[t] = distribution.get(t, 0) + 1

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
    res = neo4j_conn.run(cypher, {"limit": limit})
    if not res:
        res = memory_store.get_accounts(limit)
    return res


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
    res = neo4j_conn.run(cypher, {"limit": limit})
    if not res:
        res = memory_store.get_transactions(limit)
    return res


@router.get("/fraud-alerts")
async def get_fraud_alerts(limit: int = 100):
    """Retrieves stored fraud alerts from Neo4j or Memory."""
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
    res = neo4j_conn.run(cypher, {"limit": limit})
    if not res:
        res = memory_store.get_alerts(limit)
    return res


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
    if res:
        return res[0]

    for a in memory_store.get_alerts(1000):
        if a.get("alert_id") == alert_id or a.get("id") == alert_id:
            return a

    raise HTTPException(status_code=404, detail="Fraud alert not found")


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
    """Uploads transaction CSV into the Neo4j graph database & Memory Store."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file selected. Please choose a CSV file to upload.")

    raw = await file.read()
    if not raw or len(raw) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty (0 bytes). Please select a valid CSV file.")

    df = None
    parse_errors = []

    for encoding in ["utf-8", "utf-8-sig", "latin-1", "cp1252"]:
        try:
            df = pd.read_csv(io.BytesIO(raw), encoding=encoding)
            break
        except Exception as err:
            parse_errors.append(str(err))

    if df is None:
        raise HTTPException(
            status_code=400,
            detail=f"Could not parse file as CSV. Parsing details: {'; '.join(parse_errors)}",
        )

    # Normalize column names automatically
    df = _normalize_dataframe_columns(df)

    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        found_cols = ", ".join([f"'{c}'" for c in df.columns])
        req_cols = ", ".join([f"'{c}'" for c in REQUIRED_COLUMNS])
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {', '.join(missing)}. Found columns: [{found_cols}]. Expected columns: sender_account, receiver_account, amount.",
        )

    inserted = _load_dataframe_to_graph(df)

    # Automatically run detection rules on new data
    run_all_detections()

    return {
        "message": f"Successfully ingested {inserted} transaction record(s) into graph & streaming log.",
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

    # Automatically run detection rules on generated synthetic data
    run_all_detections()

    return {
        "message": f"Generated {inserted} synthetic transactions with planted syndicate ring.",
        "rows": inserted,
    }
