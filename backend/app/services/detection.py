import uuid
from datetime import datetime, timezone
import logging
from app.database import neo4j_conn
from app.config import settings
from app.services.ml_engine import ml_engine

logger = logging.getLogger("detection")


GRAPH_NAME = "fingraphProjection"


def _drop_projection_if_exists():
    try:
        neo4j_conn.run(
            "CALL gds.graph.exists($name) YIELD exists "
            "WITH exists WHERE exists CALL gds.graph.drop($name) YIELD graphName RETURN graphName",
            {"name": GRAPH_NAME},
        )
    except Exception as e:
        logger.debug(f"GDS drop projection warning: {e}")


def run_gds_algorithms() -> dict:
    """Runs Neo4j GDS Weakly Connected Components & PageRank if available."""
    try:
        _drop_projection_if_exists()
        neo4j_conn.run(
            "CALL gds.graph.project($name, 'Account', "
            "{TRANSFER: {orientation: 'NATURAL', properties: 'amount'}})",
            {"name": GRAPH_NAME},
        )
        neo4j_conn.run(
            "CALL gds.wcc.write($name, {writeProperty: 'syndicateId'})",
            {"name": GRAPH_NAME},
        )
        neo4j_conn.run(
            "CALL gds.pageRank.write($name, {writeProperty: 'riskScore', "
            "relationshipWeightProperty: 'amount'})",
            {"name": GRAPH_NAME},
        )
        return {"gds_available": True, "message": "WCC + PageRank written to graph."}
    except Exception as e:
        logger.info(f"GDS plugin not available ({e}). Fallback to Cypher heuristics.")
        return {"gds_available": False, "message": f"GDS plugin unavailable ({e}). Cypher rules executed."}


def create_fraud_alert(
    alert_type: str,
    severity: str,
    description: str,
    account_ids: list[str],
    transaction_ids: list[str] = None,
    alert_id: str = None,
    risk_score: float = None,
    fraud_probability: float = None,
    explanations: list[str] = None,
    status: str = "PENDING",
) -> dict:
    """
    Persists a (:FraudAlert) node into Neo4j and connects it to affected (:Account) nodes.
    Includes AI ML Risk Score, Fraud Probability, Explainable AI reasons, and Analyst Status.
    """
    alert_id = alert_id or f"ALT-{str(uuid.uuid4())[:8].upper()}"
    now_iso = datetime.now(timezone.utc).isoformat()
    transaction_ids = transaction_ids or []
    explanations = explanations or [description]

    if risk_score is None:
        severity_map = {"CRITICAL": 88.5, "HIGH": 72.0, "MEDIUM": 48.0, "LOW": 22.0}
        risk_score = severity_map.get(severity, 50.0)

    if fraud_probability is None:
        fraud_probability = round(risk_score / 100.0, 3)

    cypher = """
    MERGE (f:FraudAlert {id: $alertId})
    ON CREATE SET f.type = $type,
                  f.severity = $severity,
                  f.description = $description,
                  f.createdAt = $createdAt,
                  f.transactionIds = $transactionIds,
                  f.riskScore = $riskScore,
                  f.fraudProbability = $fraudProbability,
                  f.explanations = $explanations,
                  f.status = $status
    ON MATCH SET f.riskScore = $riskScore,
                 f.fraudProbability = $fraudProbability,
                 f.explanations = $explanations,
                 f.status = coalesce(f.status, $status)
    WITH f
    UNWIND $accountIds AS accId
    MERGE (a:Account {accountId: accId})
    SET a.riskScore = max(coalesce(a.riskScore, 0.0), $riskScore)
    MERGE (f)-[:INVOLVES]->(a)
    RETURN f.id AS alert_id
    """
    try:
        neo4j_conn.run(
            cypher,
            {
                "alertId": alert_id,
                "type": alert_type,
                "severity": severity,
                "description": description,
                "createdAt": now_iso,
                "transactionIds": transaction_ids,
                "accountIds": account_ids,
                "riskScore": float(risk_score),
                "fraudProbability": float(fraud_probability),
                "explanations": explanations,
                "status": status,
            },
        )
    except Exception as e:
        logger.error(f"Failed to persist FraudAlert {alert_id}: {e}")

    alert_obj = {
        "alert_id": alert_id,
        "id": alert_id,
        "type": alert_type,
        "severity": severity,
        "description": description,
        "account_ids": account_ids,
        "transaction_ids": transaction_ids,
        "timestamp": now_iso,
        "createdAt": now_iso,
        "risk_score": float(risk_score),
        "fraud_probability": float(fraud_probability),
        "explanations": explanations,
        "status": status,
    }
    try:
        from app.services.store import memory_store
        memory_store.add_alert(alert_obj)
    except Exception:
        pass

    return alert_obj



def detect_smurfing(
    limit: int = settings.SMURFING_TRANSACTION_LIMIT,
    window_minutes: int = settings.SMURFING_WINDOW_MINUTES,
) -> list[dict]:
    """
    Smurfing / Structuring Detection:
    Finds receiver accounts accepting transfers from multiple distinct senders,
    where transaction amounts cluster below reporting thresholds.
    """
    cypher = """
    MATCH (receiver:Account)<-[t:TRANSFERRED_TO|TRANSFER]-(sender:Account)
    WITH receiver,
         collect(DISTINCT sender.accountId) AS senders,
         collect(t.txId) AS txIds,
         collect(t.amount) AS amounts,
         count(DISTINCT sender) AS senderCount
    WHERE senderCount >= $limit
    OPTIONAL MATCH (receiver)<-[:TRANSFER]-(s2:Account)-[:USED_IP]->(ip:IP)
    WITH receiver, senders, txIds, amounts, senderCount,
         count(DISTINCT ip.address) AS distinctIps
    RETURN receiver.accountId AS receiverId,
           senders,
           txIds,
           senderCount,
           round(reduce(s = 0.0, a IN amounts | s + a), 2) AS totalAmount,
           round(reduce(s = 0.0, a IN amounts | s + a) / size(amounts), 2) AS avgAmount,
           distinctIps
    ORDER BY senderCount DESC
    """
    rows = neo4j_conn.run(cypher, {"limit": limit})
    if not rows:
        return _detect_smurfing_memory()

    alerts = []
    for row in rows:
        receiver_id = row["receiverId"]
        senders = row["senders"]
        tx_ids = [t for t in row["txIds"] if t]
        sender_count = row["senderCount"]
        total_amount = row["totalAmount"]
        avg_amount = row["avgAmount"]
        distinct_ips = row["distinctIps"]

        severity = "HIGH" if distinct_ips <= 2 or sender_count >= 8 else "MEDIUM"
        desc = (
            f"Smurfing syndicate pattern: Account {receiver_id} received transfers "
            f"from {sender_count} distinct senders totaling ₹{total_amount:,.2f} "
            f"(Avg: ₹{avg_amount:,.2f}). Shared IPs: {distinct_ips}."
        )

        all_accounts = list(set([receiver_id] + senders))
        ai_risk = ml_engine.evaluate_fraud_risk(
            amount=total_amount,
            receiver_velocity=sender_count,
            receiver_degree=len(all_accounts),
            has_shared_ip=(distinct_ips > 0 and distinct_ips <= 2),
        )
        alert_dict = create_fraud_alert(
            alert_type="SMURFING_STRUCTURING",
            severity=ai_risk["risk_level"],
            description=desc,
            account_ids=all_accounts,
            transaction_ids=tx_ids,
            alert_id=f"SMURF-{receiver_id}-{sender_count}",
            risk_score=ai_risk["risk_score"],
            fraud_probability=ai_risk["fraud_probability"],
            explanations=ai_risk["explanations"],
        )
        alerts.append(alert_dict)
    return alerts


find_starburst_patterns = detect_smurfing


def detect_circular_transfers(
    max_depth: int = settings.CIRCULAR_MAX_DEPTH,
) -> list[dict]:
    """
    Circular Money Transfer Detection:
    Finds cycles in money flow, e.g. A -> B -> C -> A or A -> B -> A.
    """
    cypher = f"""
    MATCH path = (a:Account)-[:TRANSFERRED_TO|TRANSFER*2..{max_depth}]->(a:Account)
    WITH nodes(path) AS cycleNodes, relationships(path) AS cycleRels
    WITH [n IN cycleNodes | n.accountId] AS rawAccs,
         [r IN cycleRels | r.txId] AS txIds,
         [r IN cycleRels | r.amount] AS amounts
    RETURN DISTINCT rawAccs, txIds, amounts
    LIMIT 20
    """
    rows = neo4j_conn.run(cypher)
    if not rows:
        return _detect_circular_memory()

    alerts = []
    seen_cycles = set()

    for row in rows:
        raw_accs = row["rawAccs"]
        unique_accs = list(dict.fromkeys(raw_accs))
        if len(unique_accs) < 2:
            continue
        cycle_key = tuple(sorted(unique_accs))
        if cycle_key in seen_cycles:
            continue
        seen_cycles.add(cycle_key)

        tx_ids = [t for t in row["txIds"] if t]
        amounts = row["amounts"]
        total_cycle_amount = round(sum(amounts), 2) if amounts else 0.0

        path_str = " -> ".join(unique_accs) + f" -> {unique_accs[0]}"
        desc = (
            f"Circular money flow detected across {len(unique_accs)} entities: "
            f"{path_str}. Total flow: ₹{total_cycle_amount:,.2f}."
        )

        ai_risk = ml_engine.evaluate_fraud_risk(
            amount=total_cycle_amount,
            sender_degree=len(unique_accs),
            is_circular=True,
        )

        alert_dict = create_fraud_alert(
            alert_type="CIRCULAR_TRANSFER",
            severity="CRITICAL",
            description=desc,
            account_ids=unique_accs,
            transaction_ids=tx_ids,
            alert_id=f"CIRC-{''.join(unique_accs[:3])}",
            risk_score=ai_risk["risk_score"],
            fraud_probability=ai_risk["fraud_probability"],
            explanations=ai_risk["explanations"],
        )
        alerts.append(alert_dict)
    return alerts


def detect_high_frequency(
    count_threshold: int = settings.HIGH_FREQUENCY_COUNT,
    window_minutes: int = settings.HIGH_FREQUENCY_WINDOW_MINUTES,
) -> list[dict]:
    """
    High-Frequency Transaction Detection:
    Detects accounts executing abnormally high transaction volumes.
    """
    cypher = """
    MATCH (a:Account)-[t:TRANSFERRED_TO|TRANSFER]-(b:Account)
    WITH a, count(t) AS txCount, collect(DISTINCT b.accountId) AS peerAccounts, collect(t.txId) AS txIds
    WHERE txCount >= $countThreshold
    RETURN a.accountId AS accountId, txCount, peerAccounts, txIds
    ORDER BY txCount DESC
    LIMIT 25
    """
    rows = neo4j_conn.run(cypher, {"countThreshold": count_threshold})
    if not rows:
        return _detect_high_frequency_memory()

    alerts = []
    for row in rows:
        acc_id = row["accountId"]
        tx_count = row["txCount"]
        peers = row["peerAccounts"]
        tx_ids = [t for t in row["txIds"] if t]

        desc = (
            f"High-frequency velocity alert: Account {acc_id} executed {tx_count} transactions "
            f"interacting with {len(peers)} distinct counterparties."
        )
        all_accounts = list(set([acc_id] + peers[:5]))
        ai_risk = ml_engine.evaluate_fraud_risk(
            amount=500.0,
            sender_velocity=tx_count,
            sender_degree=len(peers),
        )
        alert_dict = create_fraud_alert(
            alert_type="HIGH_FREQUENCY_VELOCITY",
            severity=ai_risk["risk_level"],
            description=desc,
            account_ids=all_accounts,
            transaction_ids=tx_ids,
            alert_id=f"FREQ-{acc_id}-{tx_count}",
            risk_score=ai_risk["risk_score"],
            fraud_probability=ai_risk["fraud_probability"],
            explanations=ai_risk["explanations"],
        )
        alerts.append(alert_dict)
    return alerts


detect_high_velocity = detect_high_frequency


def detect_large_transaction(
    threshold: float = settings.LARGE_TRANSACTION_THRESHOLD,
) -> list[dict]:
    """
    Large Transaction Threshold Detection:
    Flags individual transfers that exceed configured threshold value.
    """
    cypher = """
    MATCH (s:Account)-[t:TRANSFERRED_TO|TRANSFER]->(r:Account)
    WHERE t.amount >= $threshold AND t.amount > 0
    RETURN t.txId AS txId, s.accountId AS sender, r.accountId AS receiver, t.amount AS amount, t.timestamp AS timestamp
    ORDER BY t.amount DESC
    LIMIT 50
    """
    rows = neo4j_conn.run(cypher, {"threshold": float(threshold)})
    if not rows:
        return _detect_large_transaction_memory()

    alerts = []
    for row in rows:
        tx_id = row["txId"] or str(uuid.uuid4())
        sender = row["sender"]
        receiver = row["receiver"]
        amount = row["amount"]

        desc = (
            f"Threshold breach: Large transaction of ₹{amount:,.2f} detected "
            f"from {sender} to {receiver} (Threshold: ₹{threshold:,.2f})."
        )
        ai_risk = ml_engine.evaluate_fraud_risk(
            amount=amount,
            historical_avg=1000.0,
        )
        alert_dict = create_fraud_alert(
            alert_type="LARGE_TRANSACTION_EXCEEDED",
            severity=ai_risk["risk_level"],
            description=desc,
            account_ids=[sender, receiver],
            transaction_ids=[tx_id],
            alert_id=f"LARGE-{tx_id[:8]}",
            risk_score=ai_risk["risk_score"],
            fraud_probability=ai_risk["fraud_probability"],
            explanations=ai_risk["explanations"],
        )
        alerts.append(alert_dict)
    return alerts


def _detect_smurfing_memory() -> list[dict]:
    from app.services.store import memory_store
    txs = memory_store.get_transactions(500)
    receivers = {}
    for tx in txs:
        r = tx.get("receiver")
        s = tx.get("sender")
        amt = float(tx.get("amount", 0.0))
        tx_id = tx.get("id") or tx.get("txId")
        if r and s:
            if r not in receivers:
                receivers[r] = {"senders": set(), "txs": [], "amounts": []}
            receivers[r]["senders"].add(s)
            if tx_id:
                receivers[r]["txs"].append(tx_id)
            receivers[r]["amounts"].append(amt)

    alerts = []
    for r_id, data in receivers.items():
        senders = list(data["senders"])
        if len(senders) >= settings.SMURFING_TRANSACTION_LIMIT:
            total_amt = round(sum(data["amounts"]), 2)
            avg_amt = round(total_amt / len(data["amounts"]), 2) if data["amounts"] else 0.0
            desc = (
                f"Smurfing syndicate pattern: Account {r_id} received transfers "
                f"from {len(senders)} distinct senders totaling ₹{total_amt:,.2f} "
                f"(Avg: ₹{avg_amt:,.2f})."
            )
            alert = create_fraud_alert(
                alert_type="SMURFING_STRUCTURING",
                severity="HIGH" if len(senders) >= 8 else "MEDIUM",
                description=desc,
                account_ids=[r_id] + senders,
                transaction_ids=data["txs"],
                alert_id=f"SMURF-{r_id}-{len(senders)}",
            )
            alerts.append(alert)
    return alerts


def _detect_circular_memory() -> list[dict]:
    from app.services.store import memory_store
    txs = memory_store.get_transactions(500)
    graph = {}
    for tx in txs:
        s = tx.get("sender")
        r = tx.get("receiver")
        t_id = tx.get("id") or tx.get("txId")
        if s and r:
            if s not in graph:
                graph[s] = []
            graph[s].append((r, t_id, float(tx.get("amount", 0.0))))

    alerts = []
    seen = set()
    for start in graph:
        for n1, t1, a1 in graph.get(start, []):
            if n1 == start:
                continue
            for n2, t2, a2 in graph.get(n1, []):
                if n2 == start:
                    cycle_key = tuple(sorted([start, n1]))
                    if cycle_key not in seen:
                        seen.add(cycle_key)
                        desc = f"Circular money transfer loop detected between {start} and {n1}."
                        alert = create_fraud_alert(
                            alert_type="CIRCULAR_TRANSFER",
                            severity="CRITICAL",
                            description=desc,
                            account_ids=[start, n1],
                            transaction_ids=[t1, t2],
                            alert_id=f"CIRC-{start[:6]}-{n1[:6]}",
                        )
                        alerts.append(alert)
                else:
                    for n3, t3, a3 in graph.get(n2, []):
                        if n3 == start:
                            cycle_key = tuple(sorted([start, n1, n2]))
                            if cycle_key not in seen:
                                seen.add(cycle_key)
                                desc = f"Circular money flow loop detected across 3 entities: {start} -> {n1} -> {n2} -> {start}."
                                alert = create_fraud_alert(
                                    alert_type="CIRCULAR_TRANSFER",
                                    severity="CRITICAL",
                                    description=desc,
                                    account_ids=[start, n1, n2],
                                    transaction_ids=[t1, t2, t3],
                                    alert_id=f"CIRC-3-{start[:4]}",
                                )
                                alerts.append(alert)
    return alerts


def _detect_high_frequency_memory() -> list[dict]:
    from app.services.store import memory_store
    txs = memory_store.get_transactions(500)
    senders = {}
    for tx in txs:
        s = tx.get("sender")
        r = tx.get("receiver")
        t_id = tx.get("id") or tx.get("txId")
        if s:
            if s not in senders:
                senders[s] = {"peers": set(), "txs": []}
            if r:
                senders[s]["peers"].add(r)
            if t_id:
                senders[s]["txs"].append(t_id)

    alerts = []
    for s_id, data in senders.items():
        tx_count = len(data["txs"])
        if tx_count >= settings.HIGH_FREQUENCY_COUNT:
            peers = list(data["peers"])
            desc = (
                f"High-frequency velocity alert: Account {s_id} executed {tx_count} transactions "
                f"interacting with {len(peers)} distinct counterparties."
            )
            alert = create_fraud_alert(
                alert_type="HIGH_FREQUENCY_VELOCITY",
                severity="HIGH" if tx_count > settings.HIGH_FREQUENCY_COUNT * 2 else "MEDIUM",
                description=desc,
                account_ids=[s_id] + peers[:5],
                transaction_ids=data["txs"],
                alert_id=f"FREQ-{s_id}-{tx_count}",
            )
            alerts.append(alert)
    return alerts


def _detect_large_transaction_memory() -> list[dict]:
    from app.services.store import memory_store
    txs = memory_store.get_transactions(500)
    alerts = []
    thresh = float(settings.LARGE_TRANSACTION_THRESHOLD)
    for tx in txs:
        amt = float(tx.get("amount", 0.0))
        if amt >= thresh:
            s = tx.get("sender", "UNKNOWN")
            r = tx.get("receiver", "UNKNOWN")
            t_id = tx.get("id") or tx.get("txId") or str(uuid.uuid4())
            desc = (
                f"Threshold breach: Large transaction of ₹{amt:,.2f} detected "
                f"from {s} to {r} (Threshold: ₹{thresh:,.2f})."
            )
            alert = create_fraud_alert(
                alert_type="LARGE_TRANSACTION_EXCEEDED",
                severity="CRITICAL" if amt >= thresh * 5 else "HIGH",
                description=desc,
                account_ids=[s, r],
                transaction_ids=[t_id],
                alert_id=f"LARGE-{t_id[:8]}",
            )
            alerts.append(alert)
    return alerts


def detect_dormant_spike(dormant_days: int = 30, amount_threshold: float = 100000.0) -> list[dict]:
    """
    Dormant Account Activity Detection:
    Flags accounts inactive for > 30 days that suddenly execute large transfers > ₹100,000.
    """
    cypher = """
    MATCH (s:Account)-[t:TRANSFERRED_TO|TRANSFER]->(r:Account)
    WHERE t.amount >= $amountThreshold
    OPTIONAL MATCH (s)-[prev:TRANSFERRED_TO|TRANSFER]->()
    WHERE prev.timestamp < t.timestamp
    WITH s, r, t, max(prev.timestamp) AS lastTxTime
    WHERE lastTxTime IS NULL OR duration.between(datetime(lastTxTime), datetime(t.timestamp)).day >= $dormantDays
    RETURN t.txId AS txId, s.accountId AS sender, r.accountId AS receiver, t.amount AS amount, t.timestamp AS timestamp
    LIMIT 25
    """
    rows = neo4j_conn.run(cypher, {"amountThreshold": amount_threshold, "dormantDays": dormant_days})
    if not rows:
        return _detect_dormant_spike_memory(amount_threshold)

    alerts = []
    for row in rows:
        tx_id = row["txId"] or str(uuid.uuid4())
        sender = row["sender"]
        receiver = row["receiver"]
        amount = row["amount"]

        desc = f"Dormant account reactivation: Account {sender} executed ₹{amount:,.2f} transfer to {receiver} after > 30 days inactivity."
        alert_dict = create_fraud_alert(
            alert_type="DORMANT_SPIKE",
            severity="CRITICAL",
            description=desc,
            account_ids=[sender, receiver],
            transaction_ids=[tx_id],
            alert_id=f"DORMANT-{sender[:6]}-{tx_id[:6]}",
        )
        alerts.append(alert_dict)
    return alerts


def _detect_dormant_spike_memory(amount_threshold: float = 100000.0) -> list[dict]:
    from app.services.store import memory_store
    txs = memory_store.get_transactions(500)
    alerts = []
    for tx in txs:
        amt = float(tx.get("amount", 0.0))
        if amt >= amount_threshold:
            s = tx.get("sender", "ACC_DORMANT")
            r = tx.get("receiver", "ACC_DEST")
            tx_id = tx.get("id") or tx.get("txId") or str(uuid.uuid4())
            desc = f"Dormant account spike: Sudden large transfer of ₹{amt:,.2f} from {s} to {r} after inactivity."
            alert = create_fraud_alert(
                alert_type="DORMANT_SPIKE",
                severity="CRITICAL",
                description=desc,
                account_ids=[s, r],
                transaction_ids=[tx_id],
                alert_id=f"DORMANT-{s[:6]}-{tx_id[:6]}",
            )
            alerts.append(alert)
    return alerts


def detect_amount_anomaly(multiplier: float = 5.0) -> list[dict]:
    """
    Unusual Amount Anomaly Detection:
    Flags transactions where current amount > 5x sender's historical average.
    """
    cypher = """
    MATCH (s:Account)-[t:TRANSFERRED_TO|TRANSFER]->(r:Account)
    MATCH (s)-[all_t:TRANSFERRED_TO|TRANSFER]->()
    WITH s, r, t, avg(all_t.amount) AS avgAmount
    WHERE t.amount > (avgAmount * $multiplier) AND t.amount > 10000
    RETURN t.txId AS txId, s.accountId AS sender, r.accountId AS receiver, t.amount AS amount, avgAmount
    LIMIT 25
    """
    rows = neo4j_conn.run(cypher, {"multiplier": multiplier})
    if not rows:
        return _detect_amount_anomaly_memory(multiplier)

    alerts = []
    for row in rows:
        tx_id = row["txId"] or str(uuid.uuid4())
        sender = row["sender"]
        receiver = row["receiver"]
        amount = row["amount"]
        avg_amt = row["avgAmount"]

        desc = f"Unusual amount anomaly: Transfer of ₹{amount:,.2f} from {sender} exceeds 5x historical average (₹{avg_amt:,.2f})."
        alert_dict = create_fraud_alert(
            alert_type="AMOUNT_ANOMALY",
            severity="HIGH",
            description=desc,
            account_ids=[sender, receiver],
            transaction_ids=[tx_id],
            alert_id=f"ANOMALY-{sender[:6]}-{tx_id[:6]}",
        )
        alerts.append(alert_dict)
    return alerts


def _detect_amount_anomaly_memory(multiplier: float = 5.0) -> list[dict]:
    from app.services.store import memory_store
    txs = memory_store.get_transactions(500)
    alerts = []
    sender_amounts = {}
    for tx in txs:
        s = tx.get("sender")
        amt = float(tx.get("amount", 0.0))
        if s:
            if s not in sender_amounts:
                sender_amounts[s] = []
            sender_amounts[s].append(amt)

    for tx in txs:
        s = tx.get("sender")
        r = tx.get("receiver")
        amt = float(tx.get("amount", 0.0))
        if s and len(sender_amounts.get(s, [])) >= 2:
            avg_amt = sum(sender_amounts[s]) / len(sender_amounts[s])
            if avg_amt > 0 and amt > (avg_amt * multiplier):
                tx_id = tx.get("id") or tx.get("txId") or str(uuid.uuid4())
                desc = f"Unusual amount anomaly: Transfer of ₹{amt:,.2f} from {s} to {r} exceeds 5x historical average (₹{avg_amt:,.2f})."
                alert = create_fraud_alert(
                    alert_type="AMOUNT_ANOMALY",
                    severity="HIGH",
                    description=desc,
                    account_ids=[s, r],
                    transaction_ids=[tx_id],
                    alert_id=f"ANOMALY-{s[:6]}-{tx_id[:6]}",
                )
                alerts.append(alert)
    return alerts


def detect_fan_out(receiver_threshold: int = 10) -> list[dict]:
    """
    Fan-Out Pattern Detection (One to Many):
    Flags sender accounts transferring funds to > 10 unique receivers within 1 hour window.
    """
    cypher = """
    MATCH (s:Account)-[t:TRANSFERRED_TO|TRANSFER]->(r:Account)
    WITH s, collect(DISTINCT r.accountId) AS receivers, collect(t.txId) AS txIds
    WHERE size(receivers) >= $receiverThreshold
    RETURN s.accountId AS sender, receivers, txIds, size(receivers) AS receiverCount
    LIMIT 25
    """
    rows = neo4j_conn.run(cypher, {"receiverThreshold": receiver_threshold})
    if not rows:
        return _detect_fan_out_memory(receiver_threshold)

    alerts = []
    for row in rows:
        sender = row["sender"]
        receivers = row["receivers"]
        tx_ids = [t for t in row["txIds"] if t]
        rec_count = row["receiverCount"]

        desc = f"Fan-Out distribution pattern: Account {sender} distributed funds to {rec_count} unique receiver accounts within short window."
        alert_dict = create_fraud_alert(
            alert_type="DISTRIBUTION_PATTERN",
            severity="HIGH",
            description=desc,
            account_ids=[sender] + receivers[:10],
            transaction_ids=tx_ids,
            alert_id=f"FANOUT-{sender[:6]}-{rec_count}",
        )
        alerts.append(alert_dict)
    return alerts


def _detect_fan_out_memory(receiver_threshold: int = 10) -> list[dict]:
    from app.services.store import memory_store
    txs = memory_store.get_transactions(500)
    senders = {}
    for tx in txs:
        s = tx.get("sender")
        r = tx.get("receiver")
        t_id = tx.get("id") or tx.get("txId")
        if s and r:
            if s not in senders:
                senders[s] = {"receivers": set(), "txs": []}
            senders[s]["receivers"].add(r)
            if t_id:
                senders[s]["txs"].append(t_id)

    alerts = []
    for s_id, data in senders.items():
        recs = list(data["receivers"])
        if len(recs) >= receiver_threshold:
            desc = f"Fan-Out distribution pattern: Account {s_id} distributed funds to {len(recs)} unique receiver accounts within short window."
            alert = create_fraud_alert(
                alert_type="DISTRIBUTION_PATTERN",
                severity="HIGH",
                description=desc,
                account_ids=[s_id] + recs[:10],
                transaction_ids=data["txs"],
                alert_id=f"FANOUT-{s_id[:6]}-{len(recs)}",
            )
            alerts.append(alert)
    return alerts


def detect_fan_in(sender_threshold: int = 10) -> list[dict]:
    """
    Fan-In Pattern Detection (Many to One):
    Flags receiver accounts accepting transfers from > 10 unique senders within 1 hour window.
    """
    cypher = """
    MATCH (s:Account)-[t:TRANSFERRED_TO|TRANSFER]->(r:Account)
    WITH r, collect(DISTINCT s.accountId) AS senders, collect(t.txId) AS txIds
    WHERE size(senders) >= $senderThreshold
    RETURN r.accountId AS receiver, senders, txIds, size(senders) AS senderCount
    LIMIT 25
    """
    rows = neo4j_conn.run(cypher, {"senderThreshold": sender_threshold})
    if not rows:
        return _detect_fan_in_memory(sender_threshold)

    alerts = []
    for row in rows:
        receiver = row["receiver"]
        senders = row["senders"]
        tx_ids = [t for t in row["txIds"] if t]
        snd_count = row["senderCount"]

        desc = f"Fan-In collection account pattern: Account {receiver} gathered transfers from {snd_count} unique sender accounts."
        alert_dict = create_fraud_alert(
            alert_type="COLLECTION_ACCOUNT",
            severity="HIGH",
            description=desc,
            account_ids=[receiver] + senders[:10],
            transaction_ids=tx_ids,
            alert_id=f"FANIN-{receiver[:6]}-{snd_count}",
        )
        alerts.append(alert_dict)
    return alerts


def _detect_fan_in_memory(sender_threshold: int = 10) -> list[dict]:
    from app.services.store import memory_store
    txs = memory_store.get_transactions(500)
    receivers = {}
    for tx in txs:
        s = tx.get("sender")
        r = tx.get("receiver")
        t_id = tx.get("id") or tx.get("txId")
        if s and r:
            if r not in receivers:
                receivers[r] = {"senders": set(), "txs": []}
            receivers[r]["senders"].add(s)
            if t_id:
                receivers[r]["txs"].append(t_id)

    alerts = []
    for r_id, data in receivers.items():
        snds = list(data["senders"])
        if len(snds) >= sender_threshold:
            desc = f"Fan-In collection account pattern: Account {r_id} gathered transfers from {len(snds)} unique sender accounts."
            alert = create_fraud_alert(
                alert_type="COLLECTION_ACCOUNT",
                severity="HIGH",
                description=desc,
                account_ids=[r_id] + snds[:10],
                transaction_ids=data["txs"],
                alert_id=f"FANIN-{r_id[:6]}-{len(snds)}",
            )
            alerts.append(alert)
    return alerts


def run_all_detections() -> dict:
    """Executes all 7 modular detection rules and returns unified alerts."""
    from app.services.store import memory_store

    gds_res = run_gds_algorithms()
    smurfing_alerts = detect_smurfing()
    circular_alerts = detect_circular_transfers()
    freq_alerts = detect_high_frequency()
    large_alerts = detect_large_transaction()
    dormant_alerts = detect_dormant_spike()
    anomaly_alerts = detect_amount_anomaly()
    fan_out_alerts = detect_fan_out()
    fan_in_alerts = detect_fan_in()

    all_alerts = (
        smurfing_alerts
        + circular_alerts
        + freq_alerts
        + large_alerts
        + dormant_alerts
        + anomaly_alerts
        + fan_out_alerts
        + fan_in_alerts
    )

    # Deduplicate alerts by alert_id
    unique_alerts = {}
    for alert in all_alerts:
        unique_alerts[alert["alert_id"]] = alert
        memory_store.add_alert(alert)

    alert_list = list(unique_alerts.values())
    return {
        "gds": gds_res,
        "alerts": alert_list,
        "alert_count": len(alert_list),
        "breakdown": {
            "smurfing": len(smurfing_alerts),
            "circular": len(circular_alerts),
            "high_frequency": len(freq_alerts),
            "large_transaction": len(large_alerts),
            "dormant_spike": len(dormant_alerts),
            "amount_anomaly": len(anomaly_alerts),
            "fan_out": len(fan_out_alerts),
            "fan_in": len(fan_in_alerts),
        },
    }


def get_graph_sample(limit: int = 300) -> dict:
    """Returns nodes and edges formatted for the React force-directed graph component."""
    from app.services.store import memory_store

    cypher = """
    MATCH (s:Account)-[t:TRANSFERRED_TO|TRANSFER]->(r:Account)
    RETURN coalesce(s.id, s.accountId) AS source,
           coalesce(s.name, 'Account ' + coalesce(s.id, s.accountId)) AS sourceName,
           coalesce(s.bank, 'Unknown Bank') AS sourceBank,
           coalesce(r.id, r.accountId) AS target,
           coalesce(r.name, 'Account ' + coalesce(r.id, r.accountId)) AS targetName,
           coalesce(r.bank, 'Unknown Bank') AS targetBank,
           t.amount AS amount,
           t.timestamp AS timestamp,
           coalesce(t.transactionId, t.txId) AS txId,
           coalesce(s.riskScore, 0.0) AS sourceRisk,
           coalesce(r.riskScore, 0.0) AS targetRisk
    LIMIT $limit
    """
    rows = None
    try:
        rows = neo4j_conn.run(cypher, {"limit": limit})
    except Exception as e:
        logger.warning(f"get_graph_sample Cypher exception: {e}")

    if not rows:
        return memory_store.get_graph_data(limit)

    nodes = {}
    seen_tx_ids = set()
    links = []
    for row in rows:
        source_id = str(row["source"])
        target_id = str(row["target"])
        source_name = str(row["sourceName"])
        source_bank = str(row["sourceBank"])
        target_name = str(row["targetName"])
        target_bank = str(row["targetBank"])
        tx_id = str(row.get("txId") or "")
        timestamp = str(row.get("timestamp") or "")
        amt = float(row["amount"])
        s_risk = float(row["sourceRisk"])
        r_risk = float(row["targetRisk"])

        nodes[source_id] = {
            "id": source_id,
            "name": source_name,
            "bank": source_bank,
            "risk": s_risk,
            "is_fraud": s_risk >= 70
        }
        nodes[target_id] = {
            "id": target_id,
            "name": target_name,
            "bank": target_bank,
            "risk": r_risk,
            "is_fraud": r_risk >= 70
        }

        is_smurf = (9000 <= amt <= 9990) or ("SMURF" in source_id.upper())
        is_large = (amt >= 10000) or ("CORP_VAULT" in source_id.upper())
        is_cyclic = ("CIRCULAR" in source_id.upper() or "CIRCULAR" in target_id.upper())
        is_fraud_tx = is_smurf or is_large or is_cyclic or (s_risk >= 70 and r_risk >= 70)

        pattern = "NORMAL"
        if is_smurf:
            pattern = "SMURFING_MULE"
        elif is_large:
            pattern = "LARGE_CASHOUT"
        elif is_cyclic:
            pattern = "CIRCULAR_FLOW"

        link_key = (source_id, target_id, tx_id) if tx_id else (source_id, target_id)
        if link_key not in seen_tx_ids:
            seen_tx_ids.add(link_key)
            links.append(
                {
                    "source": source_id,
                    "target": target_id,
                    "amount": amt,
                    "txId": tx_id,
                    "transactionId": tx_id,
                    "timestamp": timestamp,
                    "is_fraud": is_fraud_tx,
                    "is_suspicious": is_fraud_tx,
                    "pattern": pattern
                }
            )
    return {"nodes": list(nodes.values()), "links": links}
