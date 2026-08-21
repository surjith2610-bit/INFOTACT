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

    return {
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
            f"from {sender_count} distinct senders totaling ${total_amount:,.2f} "
            f"(Avg: ${avg_amount:,.2f}). Shared IPs: {distinct_ips}."
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
            f"{path_str}. Total flow: ${total_cycle_amount:,.2f}."
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
            f"Threshold breach: Large transaction of ${amount:,.2f} detected "
            f"from {sender} to {receiver} (Threshold: ${threshold:,.2f})."
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
                f"from {len(senders)} distinct senders totaling ${total_amt:,.2f} "
                f"(Avg: ${avg_amt:,.2f})."
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
                f"Threshold breach: Large transaction of ${amt:,.2f} detected "
                f"from {s} to {r} (Threshold: ${thresh:,.2f})."
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


def run_all_detections() -> dict:
    """Executes all modular detection rules and returns unified alerts."""
    from app.services.store import memory_store

    gds_res = run_gds_algorithms()
    smurfing_alerts = detect_smurfing()
    circular_alerts = detect_circular_transfers()
    freq_alerts = detect_high_frequency()
    large_alerts = detect_large_transaction()

    all_alerts = smurfing_alerts + circular_alerts + freq_alerts + large_alerts

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
        },
    }


def get_graph_sample(limit: int = 300) -> dict:
    """Returns nodes and edges formatted for the React force-directed graph component."""
    from app.services.store import memory_store

    cypher = """
    MATCH (s:Account)-[t:TRANSFERRED_TO|TRANSFER]->(r:Account)
    RETURN s.accountId AS source, r.accountId AS target,
           t.amount AS amount, t.txId AS txId,
           coalesce(s.riskScore, 0.0) AS sourceRisk,
           coalesce(r.riskScore, 0.0) AS targetRisk
    LIMIT $limit
    """
    rows = neo4j_conn.run(cypher, {"limit": limit})
    if not rows:
        return memory_store.get_graph_data(limit)

    nodes = {}
    seen_tx_ids = set()
    links = []
    for row in rows:
        source_id = str(row["source"])
        target_id = str(row["target"])
        tx_id = str(row.get("txId", ""))

        nodes[source_id] = {"id": source_id, "risk": float(row["sourceRisk"])}
        nodes[target_id] = {"id": target_id, "risk": float(row["targetRisk"])}

        link_key = (source_id, target_id, tx_id) if tx_id else (source_id, target_id)
        if link_key not in seen_tx_ids:
            seen_tx_ids.add(link_key)
            links.append(
                {
                    "source": source_id,
                    "target": target_id,
                    "amount": float(row["amount"]),
                    "txId": tx_id,
                }
            )
    return {"nodes": list(nodes.values()), "links": links}
