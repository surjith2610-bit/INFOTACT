import io
import random
import uuid
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from app.database import neo4j_conn
from app.auth.routes import get_current_user
from app.services.kafka_producer import publish_transaction

router = APIRouter(prefix="/data", tags=["data"])

REQUIRED_COLUMNS = {"sender_account", "receiver_account", "amount"}


def _load_dataframe_to_graph(df: pd.DataFrame) -> int:
    """Writes each transaction row into Neo4j as (:Account)-[:TRANSACTION]->(:Account)."""
    count = 0
    for _, row in df.iterrows():
        params = {
            "txId": str(row.get("transaction_id", uuid.uuid4())),
            "sender": str(row["sender_account"]),
            "receiver": str(row["receiver_account"]),
            "amount": float(row["amount"]),
            "timestamp": str(row.get("timestamp", datetime.now(timezone.utc).isoformat())),
            "senderIp": str(row.get("sender_ip", "")) or None,
            "receiverIp": str(row.get("receiver_ip", "")) or None,
        }
        neo4j_conn.run(
            """
            MERGE (s:Account {accountId: $sender})
            MERGE (r:Account {accountId: $receiver})
            CREATE (s)-[t:TRANSACTION {
                txId: $txId, amount: $amount, timestamp: $timestamp
            }]->(r)
            FOREACH (_ IN CASE WHEN $senderIp IS NOT NULL THEN [1] ELSE [] END |
                MERGE (ip1:IP {address: $senderIp}) MERGE (s)-[:USED_IP]->(ip1))
            FOREACH (_ IN CASE WHEN $receiverIp IS NOT NULL THEN [1] ELSE [] END |
                MERGE (ip2:IP {address: $receiverIp}) MERGE (r)-[:USED_IP]->(ip2))
            """,
            params,
        )
        publish_transaction(params)  # also pushes onto the Kafka topic for the streaming path
        count += 1
    return count


@router.post("/upload-csv")
async def upload_csv(file: UploadFile = File(...), user=Depends(get_current_user)):
    """
    Expected columns: sender_account, receiver_account, amount
    Optional columns: transaction_id, timestamp, sender_ip, receiver_ip
    """
    raw = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception:
        raise HTTPException(400, "Could not parse file as CSV.")

    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise HTTPException(400, f"CSV is missing required columns: {', '.join(missing)}")

    inserted = _load_dataframe_to_graph(df)
    return {
        "message": f"Loaded {inserted} transactions into the graph.",
        "rows": inserted,
        "columns_used": list(df.columns),
    }


@router.post("/generate")
async def generate_synthetic_data(
    normal_accounts: int = 40,
    normal_transactions: int = 150,
    inject_smurfing_ring: bool = True,
    user=Depends(get_current_user),
):
    """
    Builds a synthetic transaction set so the app is usable without a real
    dataset. When inject_smurfing_ring=True, it also plants one deliberate
    fraud pattern (many small senders funneling into one shell account) so
    the detection endpoint has something real to catch.
    """
    rows = []
    accounts = [f"ACC{i:04d}" for i in range(normal_accounts)]

    for _ in range(normal_transactions):
        sender, receiver = random.sample(accounts, 2)
        rows.append({
            "transaction_id": str(uuid.uuid4()),
            "sender_account": sender,
            "receiver_account": receiver,
            "amount": round(random.uniform(20, 5000), 2),
            "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(0, 10000))).isoformat(),
            "sender_ip": f"10.0.{random.randint(0,255)}.{random.randint(0,255)}",
            "receiver_ip": f"10.0.{random.randint(0,255)}.{random.randint(0,255)}",
        })

    if inject_smurfing_ring:
        shell_account = "SHELL_OFFSHORE_01"
        smurf_senders = [f"SMURF{i:03d}" for i in range(50)]
        shared_ip = "185.220.101.7"  # all smurfs sharing one IP is the tell
        for sender in smurf_senders:
            rows.append({
                "transaction_id": str(uuid.uuid4()),
                "sender_account": sender,
                "receiver_account": shell_account,
                "amount": round(random.uniform(9500, 9900), 2),  # just under a $10k reporting threshold
                "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(0, 120))).isoformat(),
                "sender_ip": shared_ip,
                "receiver_ip": "45.33.12.99",
            })

    df = pd.DataFrame(rows)
    inserted = _load_dataframe_to_graph(df)
    return {"message": f"Generated {inserted} synthetic transactions.", "rows": inserted}
