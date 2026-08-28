import io
import random
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List
import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File, Header, Depends
from pydantic import BaseModel, EmailStr

from app.database import neo4j_conn
from app.services.kafka_producer import publish_transaction
from app.services.store import memory_store
from app.services.websocket import ws_manager
from app.services.auth import (
    authenticate_user,
    create_access_token,
    decode_access_token,
    register_user,
    USERS_DB,
)
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


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    role: Optional[str] = "ANALYST"


class AlertFeedbackRequest(BaseModel):
    status: str  # "CONFIRMED_FRAUD" | "FALSE_POSITIVE" | "PENDING"
    notes: Optional[str] = ""


from fastapi import WebSocket, WebSocketDisconnect

@router.websocket("/ws")
async def api_websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        ws_manager.disconnect(websocket)




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
    val_str = str(val).replace("₹", "").replace("$", "").replace(",", "").strip()
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


def _evaluate_suspicious_flags(txs: list) -> list:
    """Evaluates fraud flags (smurfing pattern, velocity) on transactions."""
    processed = []
    sender_ts_map = {}
    for tx in txs:
        amt = float(tx.get("amount", 0.0) or 0.0)
        sender_id = tx.get("from_account") or tx.get("sender_account") or tx.get("sender") or ""
        receiver_id = tx.get("to_account") or tx.get("receiver_account") or tx.get("receiver") or ""
        
        is_smurfing = 9000 <= amt < 10000
        is_large = amt >= 10000
        
        key = f"{sender_id}->{receiver_id}"
        if key not in sender_ts_map:
            sender_ts_map[key] = 0
        sender_ts_map[key] += 1
        is_velocity = sender_ts_map[key] > 2
        
        is_suspicious = is_smurfing or is_velocity or bool(tx.get("is_suspicious", False))
        
        reasons = []
        if is_smurfing:
            reasons.append("Smurfing / Structuring Pattern (< ₹10,000 threshold)")
        if is_velocity:
            reasons.append("High Frequency Repeated Transfer")
        if is_large:
            reasons.append("Large Transaction Threshold Exceeded")
            
        tx_copy = dict(tx)
        tx_copy["is_suspicious"] = is_suspicious
        tx_copy["risk_reasons"] = reasons
        
        # Attach nested sender/receiver dicts matching core specification
        if "sender" not in tx_copy or isinstance(tx_copy["sender"], str):
            tx_copy["sender"] = {
                "id": sender_id,
                "name": tx.get("from_name", f"Account {sender_id}"),
                "bank": tx.get("from_bank", "HDFC Bank"),
            }
        if "receiver" not in tx_copy or isinstance(tx_copy["receiver"], str):
            tx_copy["receiver"] = {
                "id": receiver_id,
                "name": tx.get("to_name", f"Account {receiver_id}"),
                "bank": tx.get("to_bank", "State Bank of India"),
            }
        processed.append(tx_copy)
    return processed


@router.get("/transactions/trace/{account_id}")
async def get_transaction_trace(
    account_id: str,
    startDate: Optional[str] = None,
    endDate: Optional[str] = None,
    minAmount: Optional[float] = None,
    maxAmount: Optional[float] = None,
):
    """
    Returns full transaction trace flow (Sender -> Receiver with Names, Banks, Amounts, Timestamps)
    for a specific account, including total incoming/outgoing amounts and fraud flags.
    """
    cypher = """
    MATCH (a:Account {accountId: $accountId})
    OPTIONAL MATCH (src:Account)-[in_t:TRANSFER|TRANSFERRED_TO]->(a)
    OPTIONAL MATCH (a)-[out_t:TRANSFER|TRANSFERRED_TO]->(dst:Account)
    RETURN a.accountId AS account_id,
           coalesce(a.name, 'Account ' + a.accountId) AS account_name,
           coalesce(a.bank, 'State Bank of India') AS account_bank,
           collect(DISTINCT {
             transaction_id: coalesce(in_t.txId, in_t.id, 'tx-in'),
             from_account: src.accountId,
             from_name: coalesce(src.name, 'Account ' + src.accountId),
             from_bank: coalesce(src.bank, 'HDFC Bank'),
             to_account: a.accountId,
             to_name: coalesce(a.name, 'Account ' + a.accountId),
             to_bank: coalesce(a.bank, 'State Bank of India'),
             amount: in_t.amount,
             timestamp: in_t.timestamp
           }) AS incoming,
           collect(DISTINCT {
             transaction_id: coalesce(out_t.txId, out_t.id, 'tx-out'),
             to_account: dst.accountId,
             to_name: coalesce(dst.name, 'Account ' + dst.accountId),
             to_bank: coalesce(dst.bank, 'ICICI Bank'),
             from_account: a.accountId,
             from_name: coalesce(a.name, 'Account ' + a.accountId),
             from_bank: coalesce(a.bank, 'State Bank of India'),
             amount: out_t.amount,
             timestamp: out_t.timestamp
           }) AS outgoing
    """
    res = None
    try:
        res = neo4j_conn.run(cypher, {"accountId": account_id})
    except Exception as e:
        logger.warning(f"Trace Cypher lookup exception: {e}")

    if not res or not res[0] or not res[0].get("account_id"):
        mem_trace = memory_store.get_transaction_trace(account_id)
        incoming_clean = [t for t in mem_trace.get("incoming", mem_trace.get("incoming_transactions", [])) if t.get("amount") is not None]
        outgoing_clean = [t for t in mem_trace.get("outgoing", mem_trace.get("outgoing_transactions", [])) if t.get("amount") is not None]
        inc_eval = _evaluate_suspicious_flags(incoming_clean)
        out_eval = _evaluate_suspicious_flags(outgoing_clean)
        return {
            "account": mem_trace["account"],
            "incoming": inc_eval,
            "outgoing": out_eval,
            "incoming_transactions": inc_eval,
            "outgoing_transactions": out_eval,
            "total_incoming": mem_trace["total_incoming"],
            "total_outgoing": mem_trace["total_outgoing"]
        }

    data = res[0]
    raw_incoming = [t for t in data.get("incoming", []) if t.get("from_account") and t.get("amount") is not None]
    raw_outgoing = [t for t in data.get("outgoing", []) if t.get("to_account") and t.get("amount") is not None]

    def _filter_txs(tx_list):
        filtered = []
        for t in tx_list:
            amt = float(t.get("amount", 0.0) or 0.0)
            ts = str(t.get("timestamp") or "")
            if minAmount is not None and amt < minAmount:
                continue
            if maxAmount is not None and amt > maxAmount:
                continue
            if startDate and ts < startDate:
                continue
            if endDate and ts > endDate:
                continue
            filtered.append(t)
        return filtered

    incoming_filtered = _filter_txs(raw_incoming)
    outgoing_filtered = _filter_txs(raw_outgoing)

    total_in = sum(float(t.get("amount", 0.0) or 0.0) for t in incoming_filtered)
    total_out = sum(float(t.get("amount", 0.0) or 0.0) for t in outgoing_filtered)

    inc_eval = _evaluate_suspicious_flags(incoming_filtered)
    out_eval = _evaluate_suspicious_flags(outgoing_filtered)

    return {
        "account": {
            "id": data["account_id"],
            "name": data["account_name"],
            "bank": data["account_bank"]
        },
        "incoming": inc_eval,
        "outgoing": out_eval,
        "incoming_transactions": inc_eval,
        "outgoing_transactions": out_eval,
        "total_incoming": round(total_in, 2),
        "total_outgoing": round(total_out, 2)
    }


@router.get("/transactions/trace")
async def search_transaction_trace(
    account_id: Optional[str] = None,
    name: Optional[str] = None,
    bank: Optional[str] = None,
    startDate: Optional[str] = None,
    endDate: Optional[str] = None,
    limit: int = 200
):
    """
    Queries and filters transactions across all accounts by Account ID, Name, Bank, or Date Range.
    """
    cypher = """
    MATCH (s:Account)-[t:TRANSFER|TRANSFERRED_TO]->(r:Account)
    RETURN t.txId AS transaction_id,
           s.accountId AS from_account,
           coalesce(s.name, 'Account ' + s.accountId) AS from_name,
           coalesce(s.bank, 'State Bank of India') AS from_bank,
           r.accountId AS to_account,
           coalesce(r.name, 'Account ' + r.accountId) AS to_name,
           coalesce(r.bank, 'HDFC Bank') AS to_bank,
           t.amount AS amount,
           t.timestamp AS timestamp
    ORDER BY t.timestamp DESC
    LIMIT $limit
    """
    res = None
    try:
        res = neo4j_conn.run(cypher, {"limit": limit})
    except Exception as e:
        logger.warning(f"Search Trace Cypher exception: {e}")

    if not res:
        res = []
        for tx in memory_store.get_transactions(limit):
            s_id = str(tx.get("sender") or "")
            r_id = str(tx.get("receiver") or "")
            s_meta = memory_store.derive_account_meta(s_id, tx.get("sender_name"), tx.get("sender_bank"))
            r_meta = memory_store.derive_account_meta(r_id, tx.get("receiver_name"), tx.get("receiver_bank"))
            res.append({
                "transaction_id": str(tx.get("id") or tx.get("txId") or ""),
                "from_account": s_id,
                "from_name": s_meta["name"],
                "from_bank": s_meta["bank"],
                "to_account": r_id,
                "to_name": r_meta["name"],
                "to_bank": r_meta["bank"],
                "amount": float(tx.get("amount", 0.0) or 0.0),
                "timestamp": str(tx.get("timestamp") or "")
            })

    filtered_txs = []
    tot_in = 0.0
    tot_out = 0.0

    for t in res:
        f_acc = str(t.get("from_account") or "").lower()
        t_acc = str(t.get("to_account") or "").lower()
        f_name = str(t.get("from_name") or "").lower()
        t_name = str(t.get("to_name") or "").lower()
        f_bank = str(t.get("from_bank") or "").lower()
        t_bank = str(t.get("to_bank") or "").lower()
        ts = str(t.get("timestamp") or "")
        amt = float(t.get("amount", 0.0) or 0.0)

        if account_id and (account_id.lower() not in f_acc and account_id.lower() not in t_acc):
            continue
        if name and (name.lower() not in f_name and name.lower() not in t_name):
            continue
        if bank and (bank.lower() not in f_bank and bank.lower() not in t_bank):
            continue
        if startDate and ts < startDate:
            continue
        if endDate and ts > endDate:
            continue

        filtered_txs.append(t)
        if account_id and account_id.lower() in t_acc:
            tot_in += amt
        if account_id and account_id.lower() in f_acc:
            tot_out += amt

    evaluated_txs = _evaluate_suspicious_flags(filtered_txs)
    total_volume = sum(float(t.get("amount", 0.0) or 0.0) for t in evaluated_txs)
    suspicious_count = sum(1 for t in evaluated_txs if t.get("is_suspicious"))

    return {
        "transactions": evaluated_txs,
        "total_count": len(evaluated_txs),
        "total_volume": round(total_volume, 2),
        "total_incoming": round(tot_in, 2) if account_id else round(total_volume / 2, 2),
        "total_outgoing": round(tot_out, 2) if account_id else round(total_volume / 2, 2),
        "suspicious_count": suspicious_count
    }


@router.post("/auth/login")
async def login(req: LoginRequest):
    """Authenticates user and returns JWT token."""
    user = authenticate_user(req.email, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    token = create_access_token({"sub": user["email"], "role": user["role"], "name": user["name"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
        }
    }


@router.post("/auth/register")
async def register(req: RegisterRequest):
    """Registers a new user account."""
    try:
        user = register_user(req.email, req.password, req.name, req.role or "ANALYST")
        token = create_access_token({"sub": user["email"], "role": user["role"], "name": user["name"]})
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user["id"],
                "email": user["email"],
                "name": user["name"],
                "role": user["role"],
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/auth/me")
async def get_current_user(authorization: Optional[str] = Header(None)):
    """Retrieves current logged in user profile."""
    if not authorization or not authorization.startswith("Bearer "):
        # Demo fallback for unauthenticated development view
        user = USERS_DB["admin@fingraph.io"]
        return {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
        }
    token = authorization.split(" ")[1]
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token.")
    user = USERS_DB.get(payload["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
    }


@router.get("/fraud-alerts")
async def get_fraud_alerts(limit: int = 100):
    """Retrieves stored fraud alerts from Neo4j or Memory."""
    cypher = """
    MATCH (fa:FraudAlert)
    OPTIONAL MATCH (fa)-[:INVOLVES]->(a:Account)
    RETURN fa.id AS id,
           fa.id AS alert_id,
           fa.type AS type,
           fa.severity AS severity,
           fa.description AS description,
           fa.createdAt AS timestamp,
           collect(DISTINCT a.accountId) AS account_ids,
           coalesce(fa.transactionIds, []) AS transaction_ids,
           coalesce(fa.riskScore, 75.0) AS risk_score,
           coalesce(fa.fraudProbability, 0.75) AS fraud_probability,
           coalesce(fa.explanations, [fa.description]) AS explanations,
           coalesce(fa.status, 'PENDING') AS status
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
           fa.id AS alert_id,
           fa.type AS type,
           fa.severity AS severity,
           fa.description AS description,
           fa.createdAt AS timestamp,
           collect(DISTINCT a.accountId) AS account_ids,
           coalesce(fa.transactionIds, []) AS transaction_ids,
           coalesce(fa.riskScore, 75.0) AS risk_score,
           coalesce(fa.fraudProbability, 0.75) AS fraud_probability,
           coalesce(fa.explanations, [fa.description]) AS explanations,
           coalesce(fa.status, 'PENDING') AS status,
           fa.analystNotes AS analyst_notes
    """
    res = neo4j_conn.run(cypher, {"alertId": alert_id})
    if res:
        return res[0]

    for a in memory_store.get_alerts(1000):
        if a.get("alert_id") == alert_id or a.get("id") == alert_id:
            return a

    raise HTTPException(status_code=404, detail="Fraud alert not found")


@router.post("/fraud-alerts/{alert_id}/feedback")
async def submit_alert_feedback(alert_id: str, req: AlertFeedbackRequest):
    """Updates analyst decision ('CONFIRMED_FRAUD' | 'FALSE_POSITIVE' | 'PENDING')."""
    if req.status not in ["CONFIRMED_FRAUD", "FALSE_POSITIVE", "PENDING"]:
        raise HTTPException(status_code=400, detail="Invalid status value.")

    cypher = """
    MATCH (fa:FraudAlert {id: $alertId})
    SET fa.status = $status,
        fa.analystNotes = $notes,
        fa.reviewedAt = datetime()
    RETURN fa.id AS id, fa.status AS status, fa.analystNotes AS notes
    """
    res = neo4j_conn.run(cypher, {"alertId": alert_id, "status": req.status, "notes": req.notes or ""})
    
    # Also update memory store if present
    for a in memory_store.get_alerts(1000):
        if a.get("alert_id") == alert_id or a.get("id") == alert_id:
            a["status"] = req.status
            a["notes"] = req.notes

    return {
        "message": f"Alert {alert_id} status updated to {req.status}.",
        "alert_id": alert_id,
        "status": req.status,
        "notes": req.notes,
    }


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
