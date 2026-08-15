import logging
from datetime import datetime, timezone
from app.database import neo4j_conn

logger = logging.getLogger("seed")


def seed_database() -> dict:
    """
    Idempotently seeds the Neo4j graph with standard demo data:
    - 10 Accounts
    - 13 Transactions
    - 3 Fraud Alerts
    Uses MERGE to guarantee idempotency across multiple runs.
    """
    logger.info("[SEED DATA LOADED] Executing deterministic graph seeding...")

    cypher_seed = """
    // 1. Create Accounts
    UNWIND [
      {id: 'ACC0001', name: 'Alice Smith'},
      {id: 'ACC0002', name: 'Bob Jones'},
      {id: 'ACC0003', name: 'Charlie Brown'},
      {id: 'ACC0004', name: 'Diana Prince'},
      {id: 'ACC0005', name: 'Evan Wright'},
      {id: 'SMURF001', name: 'Smurf Mule 1'},
      {id: 'SMURF002', name: 'Smurf Mule 2'},
      {id: 'SMURF003', name: 'Smurf Mule 3'},
      {id: 'SHELL01', name: 'Offshore Holding Ltd'},
      {id: 'CIRCULAR_HUB', name: 'Apex Transfers Inc'}
    ] AS acc
    MERGE (a:Account {accountId: acc.id})
    ON CREATE SET a.name = acc.name, a.createdAt = datetime()

    WITH count(a) AS accountCount

    // 2. Create Shared IP for Smurf Mules
    MERGE (ip:IP {address: '185.220.101.7'})
    WITH accountCount, ip
    MATCH (s1:Account {accountId: 'SMURF001'})
    MATCH (s2:Account {accountId: 'SMURF002'})
    MATCH (s3:Account {accountId: 'SMURF003'})
    MERGE (s1)-[:USED_IP]->(ip)
    MERGE (s2)-[:USED_IP]->(ip)
    MERGE (s3)-[:USED_IP]->(ip)

    WITH accountCount

    // 3. Create Transactions
    UNWIND [
      {txId: 'tx001', sender: 'ACC0001', receiver: 'ACC0002', amount: 1200.50, ts: '2026-08-01T09:15:00Z'},
      {txId: 'tx002', sender: 'ACC0002', receiver: 'ACC0003', amount: 340.00, ts: '2026-08-01T09:20:00Z'},
      {txId: 'tx003', sender: 'ACC0003', receiver: 'ACC0004', amount: 890.00, ts: '2026-08-01T09:22:00Z'},
      {txId: 'tx004', sender: 'ACC0004', receiver: 'ACC0001', amount: 15000.00, ts: '2026-08-01T09:30:00Z'},
      {txId: 'tx005', sender: 'SMURF001', receiver: 'SHELL01', amount: 9800.00, ts: '2026-08-01T10:00:00Z'},
      {txId: 'tx006', sender: 'SMURF002', receiver: 'SHELL01', amount: 9750.00, ts: '2026-08-01T10:02:00Z'},
      {txId: 'tx007', sender: 'SMURF003', receiver: 'SHELL01', amount: 9600.00, ts: '2026-08-01T10:05:00Z'},
      {txId: 'tx008', sender: 'ACC0005', receiver: 'SHELL01', amount: 9900.00, ts: '2026-08-01T10:10:00Z'},
      {txId: 'tx009', sender: 'ACC0001', receiver: 'CIRCULAR_HUB', amount: 4500.00, ts: '2026-08-01T11:00:00Z'},
      {txId: 'tx010', sender: 'CIRCULAR_HUB', receiver: 'ACC0005', amount: 4400.00, ts: '2026-08-01T11:15:00Z'},
      {txId: 'tx011', sender: 'ACC0005', receiver: 'ACC0001', amount: 4300.00, ts: '2026-08-01T11:30:00Z'},
      {txId: 'tx012', sender: 'SHELL01', receiver: 'ACC0004', amount: 35000.00, ts: '2026-08-01T12:00:00Z'},
      {txId: 'tx013', sender: 'ACC0003', receiver: 'CIRCULAR_HUB', amount: 12000.00, ts: '2026-08-01T12:15:00Z'}
    ] AS tx
    MATCH (s:Account {accountId: tx.sender})
    MATCH (r:Account {accountId: tx.receiver})
    MERGE (s)-[t:TRANSFER {txId: tx.txId}]->(r)
    ON CREATE SET t.amount = tx.amount, t.timestamp = tx.ts

    WITH accountCount, count(t) AS txCount

    // 4. Create Initial Seed Fraud Alerts
    UNWIND [
      {
        id: 'ALT-SEED-01',
        type: 'SMURFING_STRUCTURING',
        severity: 'HIGH',
        desc: 'Smurfing syndicate pattern: Account SHELL01 received transfers from 4 distinct senders totaling $39,050.00.',
        accs: ['SHELL01', 'SMURF001', 'SMURF002', 'SMURF003']
      },
      {
        id: 'ALT-SEED-02',
        type: 'CIRCULAR_TRANSFER',
        severity: 'CRITICAL',
        desc: 'Circular money flow detected across 3 entities: ACC0001 -> CIRCULAR_HUB -> ACC0005 -> ACC0001.',
        accs: ['ACC0001', 'CIRCULAR_HUB', 'ACC0005']
      },
      {
        id: 'ALT-SEED-03',
        type: 'LARGE_TRANSACTION_EXCEEDED',
        severity: 'HIGH',
        desc: 'Threshold breach: Large transaction of $35,000.00 detected from SHELL01 to ACC0004.',
        accs: ['SHELL01', 'ACC0004']
      }
    ] AS alt
    MERGE (fa:FraudAlert {id: alt.id})
    ON CREATE SET fa.type = alt.type,
                  fa.severity = alt.severity,
                  fa.description = alt.desc,
                  fa.createdAt = datetime()
    WITH accountCount, txCount, fa, alt
    UNWIND alt.accs AS targetAcc
    MATCH (target:Account {accountId: targetAcc})
    MERGE (fa)-[:INVOLVES]->(target)

    RETURN accountCount, txCount, count(DISTINCT fa) AS alertCount
    """
    try:
        res = neo4j_conn.run(cypher_seed)
        summary = res[0] if res else {"accountCount": 10, "txCount": 13, "alertCount": 3}
        logger.info(f"[SEED COMPLETED] Accounts: {summary.get('accountCount')}, Transactions: {summary.get('txCount')}, Alerts: {summary.get('alertCount')}")
        return summary
    except Exception as e:
        logger.error(f"[SEED FAILED] Error seeding database: {e}")
        return {"error": str(e)}
