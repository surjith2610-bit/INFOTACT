import io
import random
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List
import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File, Header, Depends
from pydantic import BaseModel, EmailStr

from app.config import settings
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


class CreateCaseRequest(BaseModel):
    suspect_account_id: str
    title: Optional[str] = None
    severity: Optional[str] = "HIGH"
    status: Optional[str] = "OPEN"
    total_amount_at_risk: Optional[float] = 0.0
    assigned_to: Optional[str] = "Senior AML Investigator"
    initial_note: Optional[str] = "Case initialized from detection workbench."
    evidence_transaction_ids: Optional[List[str]] = []
    evidence_alert_ids: Optional[List[str]] = []
    summary: Optional[str] = ""


class AddCaseNoteRequest(BaseModel):
    author: Optional[str] = "AML Analyst"
    content: str


class UpdateCaseStatusRequest(BaseModel):
    status: str  # "OPEN" | "UNDER_INVESTIGATION" | "ESCALATED_FIU" | "CLOSED_RESOLVED" | "FALSE_POSITIVE"
    user: Optional[str] = "AML Investigator"



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

        sender_name = str(row.get("sender_name", "")).strip()
        sender_bank = str(row.get("sender_bank", "")).strip()
        receiver_name = str(row.get("receiver_name", "")).strip()
        receiver_bank = str(row.get("receiver_bank", "")).strip()

        s_meta = memory_store.derive_account_meta(sender, sender_name or None, sender_bank or None)
        r_meta = memory_store.derive_account_meta(receiver, receiver_name or None, receiver_bank or None)

        params = {
            "txId": tx_id,
            "sender": sender,
            "senderName": s_meta["name"],
            "senderBank": s_meta["bank"],
            "receiver": receiver,
            "receiverName": r_meta["name"],
            "receiverBank": r_meta["bank"],
            "amount": amount,
            "timestamp": timestamp,
            "senderIp": sender_ip,
            "receiverIp": receiver_ip,
        }

        # 1. Update Neo4j graph
        cypher = """
        MERGE (s:Account {id: $sender})
        ON CREATE SET s.accountId = $sender, s.name = $senderName, s.bank = $senderBank
        ON MATCH SET s.accountId = coalesce(s.accountId, $sender), s.name = coalesce(s.name, $senderName), s.bank = coalesce(s.bank, $senderBank)

        MERGE (r:Account {id: $receiver})
        ON CREATE SET r.accountId = $receiver, r.name = $receiverName, r.bank = $receiverBank
        ON MATCH SET r.accountId = coalesce(r.accountId, $receiver), r.name = coalesce(r.name, $receiverName), r.bank = coalesce(r.bank, $receiverBank)

        MERGE (s)-[t:TRANSFERRED_TO {transactionId: $txId}]->(r)
        ON CREATE SET t.amount = $amount, t.timestamp = $timestamp, t.txId = $txId

        MERGE (s)-[t_legacy:TRANSFER {txId: $txId}]->(r)
        ON CREATE SET t_legacy.amount = $amount, t_legacy.timestamp = $timestamp, t_legacy.transactionId = $txId

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
            "sender_name": s_meta["name"],
            "sender_bank": s_meta["bank"],
            "receiver": receiver,
            "receiver_name": r_meta["name"],
            "receiver_bank": r_meta["bank"],
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
        
        rate = float(getattr(settings, "EXCHANGE_RATE", 83.0))
        large_thresh = float(getattr(settings, "LARGE_TRANSACTION_THRESHOLD", 830000.0))
        smurf_lower = large_thresh * 0.90
        
        is_smurfing = (smurf_lower <= amt < large_thresh) or (9000 <= amt < 10000)
        is_large = amt >= large_thresh
        
        key = f"{sender_id}->{receiver_id}"
        if key not in sender_ts_map:
            sender_ts_map[key] = 0
        sender_ts_map[key] += 1
        is_velocity = sender_ts_map[key] > 2
        
        is_suspicious = is_smurfing or is_velocity or bool(tx.get("is_suspicious", False))
        
        reasons = []
        if is_smurfing:
            reasons.append(f"Smurfing / Structuring Pattern (< ₹{large_thresh:,.0f} threshold)")
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


# ============================================================================
# 🎯 CORE SPECIFICATION: MANDATORY TRANSACTION TRACE & INTELLIGENCE APIS
# ============================================================================

@router.get("/account/{account_id}/transactions")
async def get_account_transactions(account_id: str):
    """
    1. Account Transaction History
    GET /api/account/:accountId/transactions
    Returns full account identity details (Account ID, Holder Name, Bank Name, Branch, IFSC Code)
    and all incoming + outgoing transactions with exact edge details.
    """
    # Cypher query with in-memory fallback
    cypher = """
    MATCH (a:Account)
    WHERE a.id = $accId OR a.accountId = $accId
    OPTIONAL MATCH (src:Account)-[in_t:TRANSFERRED_TO|TRANSFER]->(a)
    OPTIONAL MATCH (a)-[out_t:TRANSFERRED_TO|TRANSFER]->(dst:Account)
    RETURN
      coalesce(a.id, a.accountId) AS account_id,
      coalesce(a.name, 'Account ' + coalesce(a.id, a.accountId)) AS name,
      coalesce(a.bank, 'State Bank of India') AS bank,
      coalesce(a.branch, 'Central Branch') AS branch,
      coalesce(a.ifscCode, a.ifsc, 'SBIN0001001') AS ifsc,
      coalesce(a.riskScore, 0.0) AS risk_score,
      collect(DISTINCT {
        transactionId: coalesce(in_t.txId, in_t.transactionId, in_t.id, 'tx-in'),
        from: coalesce(src.id, src.accountId),
        fromName: coalesce(src.name, 'Account ' + coalesce(src.id, src.accountId)),
        bankFrom: coalesce(src.bank, 'HDFC Bank'),
        to: coalesce(a.id, a.accountId),
        toName: coalesce(a.name, 'Account ' + coalesce(a.id, a.accountId)),
        bankTo: coalesce(a.bank, 'State Bank of India'),
        amount: in_t.amount,
        timestamp: in_t.timestamp,
        channel: coalesce(in_t.channel, 'UPI')
      }) AS incoming,
      collect(DISTINCT {
        transactionId: coalesce(out_t.txId, out_t.transactionId, out_t.id, 'tx-out'),
        from: coalesce(a.id, a.accountId),
        fromName: coalesce(a.name, 'Account ' + coalesce(a.id, a.accountId)),
        bankFrom: coalesce(a.bank, 'State Bank of India'),
        to: coalesce(dst.id, dst.accountId),
        toName: coalesce(dst.name, 'Account ' + coalesce(dst.id, dst.accountId)),
        bankTo: coalesce(dst.bank, 'ICICI Bank'),
        amount: out_t.amount,
        timestamp: out_t.timestamp,
        channel: coalesce(out_t.channel, 'IMPS')
      }) AS outgoing
    """
    res = None
    try:
        res = neo4j_conn.run(cypher, {"accId": account_id})
    except Exception as e:
        logger.warning(f"Neo4j account transactions lookup exception: {e}")

    if not res or not res[0] or not res[0].get("account_id"):
        return memory_store.get_account_transactions(account_id)

    row = res[0]
    meta = memory_store.derive_account_meta(account_id, row.get("name"), row.get("bank"))
    inc = [t for t in row.get("incoming", []) if t.get("from") and t.get("amount") is not None]
    out = [t for t in row.get("outgoing", []) if t.get("to") and t.get("amount") is not None]

    tot_in = sum(float(t.get("amount", 0.0) or 0.0) for t in inc)
    tot_out = sum(float(t.get("amount", 0.0) or 0.0) for t in out)

    return {
        "account": {
            "accountId": account_id,
            "accountHolderName": meta["name"],
            "name": meta["name"],
            "bankName": meta["bank"],
            "bank": meta["bank"],
            "branch": meta["branch"],
            "ifscCode": meta["ifscCode"],
            "riskScore": float(row.get("risk_score") or memory_store.derive_risk_score(account_id)),
        },
        "incoming": inc,
        "outgoing": out,
        "incoming_transactions": inc,
        "outgoing_transactions": out,
        "total_incoming": round(tot_in, 2),
        "total_outgoing": round(tot_out, 2),
        "total_volume": round(tot_in + tot_out, 2),
    }


@router.get("/trace/{transaction_id}")
async def get_multi_hop_trace(transaction_id: str, depth: int = 5):
    """
    2. Full Trace (Multi-Hop Flow)
    GET /api/trace/:transactionId?depth=5
    Traces multi-hop propagation chain: A → B → C → D → E.
    Returns hops chain, connected nodes, edges, and AI Money Flow Narrative.
    """
    # Neo4j multi-hop path query if online
    cypher = f"""
    MATCH (s:Account)-[t:TRANSFERRED_TO|TRANSFER]->(r:Account)
    WHERE coalesce(t.transactionId, t.txId) = $txId OR s.id = $txId OR s.accountId = $txId
    OPTIONAL MATCH path = (s)-[:TRANSFERRED_TO|TRANSFER*1..{depth}]->(target:Account)
    RETURN [n IN nodes(path) | coalesce(n.id, n.accountId)] AS nodeIds,
           [rel IN relationships(path) | {{
              transactionId: coalesce(rel.transactionId, rel.txId),
              from: coalesce(startNode(rel).id, startNode(rel).accountId),
              to: coalesce(endNode(rel).id, endNode(rel).accountId),
              amount: rel.amount,
              timestamp: rel.timestamp,
              channel: coalesce(rel.channel, 'UPI')
           }}] AS edgeList
    LIMIT 10
    """
    try:
        rows = neo4j_conn.run(cypher, {"txId": transaction_id})
        if rows and len(rows) > 0 and rows[0].get("edgeList"):
            # If path returned from Neo4j, format and return
            edge_list = rows[0]["edgeList"]
            if edge_list and len(edge_list) > 0:
                nodes_out = []
                seen_nodes = set()
                edges_out = []
                chain_hops = []
                for idx, e in enumerate(edge_list):
                    s_id = str(e["from"])
                    t_id = str(e["to"])
                    amt = float(e["amount"] or 0.0)
                    ts = str(e.get("timestamp") or "")
                    s_meta = memory_store.derive_account_meta(s_id)
                    r_meta = memory_store.derive_account_meta(t_id)

                    for n_id, n_m in [(s_id, s_meta), (t_id, r_meta)]:
                        if n_id not in seen_nodes:
                            seen_nodes.add(n_id)
                            nodes_out.append({
                                "id": n_id,
                                "accountId": n_id,
                                "name": n_m["name"],
                                "bank": n_m["bank"],
                                "branch": n_m["branch"],
                                "ifsc": n_m["ifscCode"],
                                "riskScore": memory_store.derive_risk_score(n_id),
                            })
                    edges_out.append({
                        "transactionId": e.get("transactionId") or f"tx-hop-{idx}",
                        "from": s_id,
                        "to": t_id,
                        "amount": amt,
                        "timestamp": ts,
                        "bankFrom": s_meta["bank"],
                        "bankTo": r_meta["bank"],
                        "channel": e.get("channel", "UPI"),
                    })
                    chain_hops.append({
                        "hop": idx + 1,
                        "from": s_id,
                        "to": t_id,
                        "amount": amt,
                        "timestamp": ts,
                        "transactionId": e.get("transactionId"),
                        "channel": e.get("channel", "UPI"),
                    })

                origin = chain_hops[0]["from"]
                dest = chain_hops[-1]["to"]
                tot_vol = sum(h["amount"] for h in chain_hops)
                origin_m = memory_store.derive_account_meta(origin)
                dest_m = memory_store.derive_account_meta(dest)

                return {
                    "transactionId": transaction_id,
                    "depth": depth,
                    "hops": chain_hops,
                    "nodes": nodes_out,
                    "edges": edges_out,
                    "narrative": {
                        "origin": f"{origin} ({origin_m['name']}, {origin_m['bank']})",
                        "destination": f"{dest} ({dest_m['name']}, {dest_m['bank']})",
                        "totalHops": len(chain_hops),
                        "totalVolume": round(tot_vol, 2),
                        "flowPath": " → ".join([origin] + [h["to"] for h in chain_hops]),
                        "summaryText": f"Funds originated at {origin_m['name']} ({origin_m['bank']}) and routed through {len(chain_hops)} hops to {dest_m['name']} ({dest_m['bank']}).",
                    },
                    "riskAnalysis": {
                        "isSuspicious": len(chain_hops) >= 3 or tot_vol >= 10000,
                        "riskLevel": "HIGH" if (len(chain_hops) >= 3 or tot_vol >= 10000) else "LOW",
                        "reasons": ["Multi-hop fund transfer chain detected across distinct banking entities."],
                    }
                }
    except Exception as e:
        logger.warning(f"Neo4j trace exception: {e}")

    # Fallback to high performance in-memory multi-hop trace
    return memory_store.trace_transaction_chain(transaction_id, depth)


@router.get("/flow/{account_id}")
async def get_money_flow_graph(account_id: str, depth: int = 3):
    """
    3. Money Flow Graph
    GET /api/flow/:accountId?depth=3
    Returns strict node-edge graph format for visualization:
    Node = Account, Edge = Transaction with bankFrom, bankTo, channel.
    """
    cypher = f"""
    MATCH (center:Account)
    WHERE center.id = $accId OR center.accountId = $accId
    OPTIONAL MATCH path = (center)-[t:TRANSFERRED_TO|TRANSFER*1..{depth}]-(peer:Account)
    UNWIND relationships(path) AS rel
    WITH DISTINCT rel
    RETURN
      coalesce(rel.transactionId, rel.txId, 'tx') AS transactionId,
      coalesce(startNode(rel).id, startNode(rel).accountId) AS from,
      coalesce(startNode(rel).name, 'Account ' + coalesce(startNode(rel).id, startNode(rel).accountId)) AS senderName,
      coalesce(startNode(rel).bank, 'State Bank of India') AS bankFrom,
      coalesce(endNode(rel).id, endNode(rel).accountId) AS to,
      coalesce(endNode(rel).name, 'Account ' + coalesce(endNode(rel).id, endNode(rel).accountId)) AS receiverName,
      coalesce(endNode(rel).bank, 'ICICI Bank') AS bankTo,
      rel.amount AS amount,
      rel.timestamp AS timestamp,
      coalesce(rel.channel, 'UPI') AS channel
    """
    try:
        rows = neo4j_conn.run(cypher, {"accId": account_id})
        if rows and len(rows) > 0 and rows[0].get("from"):
            nodes_dict = {}
            edges_out = []
            for r in rows:
                f_id = str(r["from"])
                t_id = str(r["to"])
                amt = float(r.get("amount", 0.0) or 0.0)
                ts = str(r.get("timestamp") or "")
                tx_id = str(r.get("transactionId") or "")
                channel = str(r.get("channel") or "UPI")

                f_meta = memory_store.derive_account_meta(f_id, r.get("senderName"), r.get("bankFrom"))
                t_meta = memory_store.derive_account_meta(t_id, r.get("receiverName"), r.get("bankTo"))

                if f_id not in nodes_dict:
                    nodes_dict[f_id] = {
                        "id": f_id,
                        "name": f_meta["name"],
                        "bank": f_meta["bank"],
                        "branch": f_meta["branch"],
                        "ifsc": f_meta["ifscCode"],
                        "riskScore": memory_store.derive_risk_score(f_id),
                    }
                if t_id not in nodes_dict:
                    nodes_dict[t_id] = {
                        "id": t_id,
                        "name": t_meta["name"],
                        "bank": t_meta["bank"],
                        "branch": t_meta["branch"],
                        "ifsc": t_meta["ifscCode"],
                        "riskScore": memory_store.derive_risk_score(t_id),
                    }
                edges_out.append({
                    "transactionId": tx_id,
                    "from": f_id,
                    "to": t_id,
                    "amount": amt,
                    "timestamp": ts,
                    "bankFrom": f_meta["bank"],
                    "bankTo": t_meta["bank"],
                    "channel": channel,
                })
            return {"nodes": list(nodes_dict.values()), "edges": edges_out}
    except Exception as e:
        logger.warning(f"Neo4j flow graph query exception: {e}")

    return memory_store.get_flow_graph(account_id, depth)


@router.get("/fraud/analyze/{account_id}")
async def get_fraud_analysis_for_account(account_id: str):
    """
    4. Fraud Detection Engine
    GET /api/fraud/analyze/:accountId
    Returns risk score (0-100), risk level, and flags for:
    - Smurfing (< ₹10,000 rapid splitting)
    - Circular Flow (A → B → C → A)
    - Burst Activity (5+ transfers in < 60 seconds)
    - Layering Pattern (Multiple rapid hops)
    - Structuring (Repeated identical amounts)
    Includes AI Money Flow Narrative and reasoning.
    """
    return memory_store.analyze_fraud_for_account(account_id)


# ============================================================================
# COMPATIBILITY ALIASES
# ============================================================================

@router.get("/transactions/full-trace/{account_id}")
async def get_full_transaction_trace(account_id: str):
    """
    GET /transactions/full-trace/:accountId
    Returns identity-level transaction traceability for all transfers connected to account_id:
    WHO sent money -> TO WHOM -> FROM WHICH BANK -> TO WHICH BANK -> HOW MUCH -> WHEN.
    """
    cypher = """
    MATCH (a:Account)-[t:TRANSFERRED_TO|TRANSFER]->(b:Account)
    WHERE a.id = $accountId OR a.accountId = $accountId OR b.id = $accountId OR b.accountId = $accountId
    RETURN
      coalesce(a.id, a.accountId) AS sender_id,
      coalesce(a.name, 'Account ' + coalesce(a.id, a.accountId)) AS sender_name,
      coalesce(a.bank, 'Unknown Bank') AS sender_bank,
      coalesce(b.id, b.accountId) AS receiver_id,
      coalesce(b.name, 'Account ' + coalesce(b.id, b.accountId)) AS receiver_name,
      coalesce(b.bank, 'Unknown Bank') AS receiver_bank,
      t.amount AS amount,
      t.timestamp AS timestamp,
      coalesce(t.transactionId, t.txId) AS transactionId
    ORDER BY t.timestamp DESC
    """
    res = None
    try:
        res = neo4j_conn.run(cypher, {"accountId": account_id})
    except Exception as e:
        logger.warning(f"Full trace Cypher exception: {e}")

    if not res:
        return memory_store.get_full_trace(account_id)

    formatted_txs = []
    for r in res:
        formatted_txs.append({
            "sender": {
                "id": str(r.get("sender_id") or ""),
                "name": str(r.get("sender_name") or ""),
                "bank": str(r.get("sender_bank") or ""),
            },
            "receiver": {
                "id": str(r.get("receiver_id") or ""),
                "name": str(r.get("receiver_name") or ""),
                "bank": str(r.get("receiver_bank") or ""),
            },
            "amount": float(r.get("amount", 0.0) or 0.0),
            "timestamp": str(r.get("timestamp") or ""),
            "transactionId": str(r.get("transactionId") or "")
        })

    return {"transactions": formatted_txs}


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
@router.post("/run-detection")
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


@router.get("/config")
async def get_system_config():
    """Returns currency and exchange rate configuration for UI."""
    return {
        "currency": getattr(settings, "CURRENCY", "INR"),
        "exchange_rate": float(getattr(settings, "EXCHANGE_RATE", 83.0)),
        "large_transaction_threshold": float(getattr(settings, "LARGE_TRANSACTION_THRESHOLD", 830000.0)),
    }


@router.post("/data/generate")
async def generate_synthetic(
    normal_accounts: int = 40,
    normal_transactions: int = 150,
    inject_smurfing_ring: bool = True,
):
    """Generates synthetic dataset with optional planted smurfing syndicate scaled to configured currency."""
    rows = []
    accounts = [f"ACC{i:04d}" for i in range(normal_accounts)]
    rate = float(getattr(settings, "EXCHANGE_RATE", 83.0))

    for _ in range(normal_transactions):
        sender, receiver = random.sample(accounts, 2)
        # Normal retail transfers (e.g., ₹1,500 to ₹3,50,000)
        rows.append(
            {
                "transaction_id": f"tx-gen-{uuid.uuid4().hex[:8]}",
                "sender_account": sender,
                "receiver_account": receiver,
                "amount": round(random.uniform(20.0, 4200.0) * rate, 2),
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
            # Smurfing transfers (~₹7,88,500 to ₹8,25,850, clustered just below ₹8.3L SAR threshold)
            rows.append(
                {
                    "transaction_id": f"tx-smurf-{uuid.uuid4().hex[:8]}",
                    "sender_account": sender,
                    "receiver_account": shell_account,
                    "amount": round(random.uniform(9500.0, 9950.0) * rate, 2),
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
        "message": f"Generated {inserted} synthetic transactions with planted syndicate ring (Currency: {getattr(settings, 'CURRENCY', 'INR')}).",
        "rows": inserted,
    }


# ==========================================
# 360° TRANSACTION DRILL-DOWN & MULTI-HOP
# ==========================================
@router.get("/account/{account_id}/drilldown")
async def get_account_drilldown_endpoint(account_id: str):
    """
    Returns 360° forensic investigation drilldown for an account:
    Metadata, Counterparty transactions, Multi-hop path trace, Flow graph, and XAI risk breakdown.
    """
    data = memory_store.get_account_drilldown(account_id)
    return data


# ==========================================
# TIMELINE PLAYBACK & FILTERING
# ==========================================
@router.get("/transactions/timeline")
async def get_transactions_timeline_endpoint(
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    bank: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    fraud_only: Optional[bool] = False,
    limit: Optional[int] = 300,
):
    """
    Returns filtered transactions sorted chronologically with graph nodes and links for timeline playback animation.
    """
    return memory_store.get_transactions_timeline(
        start_time=start_time,
        end_time=end_time,
        bank=bank,
        min_amount=min_amount,
        max_amount=max_amount,
        fraud_only=fraud_only,
        limit=limit,
    )


# ==========================================
# SYNDICATE PATTERN SUBGRAPHS
# ==========================================
@router.get("/graph/patterns")
async def get_syndicate_patterns_endpoint():
    """
    Returns isolated subgraphs for detected AML syndicates (Starburst, Circular Loop, High-Value Drain).
    """
    return memory_store.get_syndicate_subgraphs()


# ==========================================
# CASE MANAGEMENT SYSTEM
# ==========================================
@router.post("/cases")
async def create_case_endpoint(req: CreateCaseRequest):
    """Creates a new AML investigation case."""
    case_obj = memory_store.create_case(req.dict())
    return {
        "message": f"Case {case_obj['case_id']} created successfully.",
        "case": case_obj,
    }


@router.get("/cases")
async def list_cases_endpoint(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    search: Optional[str] = None,
    limit: Optional[int] = 100,
):
    """Lists all AML investigation cases with optional filtering."""
    cases = memory_store.get_cases(status=status, severity=severity, search=search, limit=limit)
    return {
        "total": len(cases),
        "cases": cases,
    }


@router.get("/cases/{case_id}")
async def get_case_detail_endpoint(case_id: str):
    """Returns detailed dossier for an investigation case."""
    c = memory_store.get_case(case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")
    return c


@router.post("/cases/{case_id}/notes")
async def add_case_note_endpoint(case_id: str, req: AddCaseNoteRequest):
    """Appends an investigator note and audit record to a case."""
    c = memory_store.add_case_note(case_id, author=req.author, content=req.content)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")
    return {
        "message": "Note added successfully.",
        "case": c,
    }


@router.patch("/cases/{case_id}/status")
async def update_case_status_endpoint(case_id: str, req: UpdateCaseStatusRequest):
    """Updates the workflow status of an investigation case."""
    valid_statuses = {"OPEN", "UNDER_INVESTIGATION", "ESCALATED", "ESCALATED_SAR", "ESCALATED_FIU", "CLOSED_RESOLVED", "FALSE_POSITIVE"}
    if req.status.upper() not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status '{req.status}'. Must be one of: {', '.join(valid_statuses)}")
    c = memory_store.update_case_status(case_id, status=req.status.upper(), user=req.user)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")
    return {
        "message": f"Case status updated to {req.status.upper()}.",
        "case": c,
    }


@router.get("/cases/{case_id}/export")
async def export_case_dossier_endpoint(case_id: str):
    """
    Generates a structured AML Case Dossier report payload with summary, evidence, and risk breakdown for client PDF export.
    """
    c = memory_store.get_case(case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")
    
    suspect_acc = c.get("suspect_account_id")
    drilldown = memory_store.get_account_drilldown(suspect_acc) if suspect_acc else {}

    return {
        "case": c,
        "suspect_profile": drilldown.get("account", {}),
        "metrics": drilldown.get("metrics", {}),
        "incoming_evidence": drilldown.get("incoming_transactions", [])[:15],
        "outgoing_evidence": drilldown.get("outgoing_transactions", [])[:15],
        "xai_breakdown": drilldown.get("xai_breakdown", {}),
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "CONFIDENTIAL FINANCIAL INTELLIGENCE DOSSIER — For authorized AML compliance officers only.",
    }

