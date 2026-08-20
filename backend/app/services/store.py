"""
In-Memory Storage & Cache Layer for FinGraph.
Serves as a high-performance buffer and graceful fallback when Neo4j database is offline.
"""
import uuid
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("store")


class InMemoryStore:
    def __init__(self):
        self.transactions: list[dict] = []
        self.alerts: list[dict] = []

    def add_transaction(self, tx: dict):
        # Store latest transactions first
        self.transactions.insert(0, tx)
        # Cap memory buffer at 5,000 transactions
        if len(self.transactions) > 5000:
            self.transactions.pop()

    def add_transactions_bulk(self, tx_list: list[dict]):
        for tx in reversed(tx_list):
            self.add_transaction(tx)

    def get_transactions(self, limit: int = 100) -> list[dict]:
        return self.transactions[:limit]

    def get_accounts(self, limit: int = 100) -> list[dict]:
        accounts_map = {}
        for tx in self.transactions:
            s = tx.get("sender")
            r = tx.get("receiver")
            amt = tx.get("amount", 0.0)
            if s:
                if s not in accounts_map:
                    accounts_map[s] = {"id": s, "outbound_count": 0, "inbound_count": 0, "risk_score": 0.0}
                accounts_map[s]["outbound_count"] += 1
            if r:
                if r not in accounts_map:
                    accounts_map[r] = {"id": r, "outbound_count": 0, "inbound_count": 0, "risk_score": 0.0}
                accounts_map[r]["inbound_count"] += 1

        acc_list = list(accounts_map.values())
        acc_list.sort(key=lambda x: x["inbound_count"] + x["outbound_count"], reverse=True)
        return acc_list[:limit]

    def get_graph_data(self, limit: int = 300) -> dict:
        nodes = {}
        links = []
        tx_slice = self.transactions[:limit]

        for tx in tx_slice:
            s = str(tx.get("sender", ""))
            r = str(tx.get("receiver", ""))
            amt = float(tx.get("amount", 0.0))
            tx_id = str(tx.get("id") or tx.get("txId") or "")

            if s:
                nodes[s] = {"id": s, "risk": 0.0}
            if r:
                nodes[r] = {"id": r, "risk": 0.0}

            if s and r:
                links.append({"source": s, "target": r, "amount": amt, "txId": tx_id})

        return {"nodes": list(nodes.values()), "links": links}

    def add_alert(self, alert: dict):
        # Avoid duplicate alert_id
        for idx, existing in enumerate(self.alerts):
            if existing.get("alert_id") == alert.get("alert_id") or existing.get("id") == alert.get("id"):
                self.alerts[idx] = alert
                return
        self.alerts.insert(0, alert)

    def get_alerts(self, limit: int = 100) -> list[dict]:
        return self.alerts[:limit]

    def seed_default_data_if_empty(self):
        if len(self.transactions) > 0:
            return

        logger.info("[STORE] Initializing in-memory store with default sample transactions...")
        sample_rows = []
        accounts = [f"ACC{i:04d}" for i in range(20)]

        for i in range(60):
            sender = accounts[i % len(accounts)]
            receiver = accounts[(i + 3) % len(accounts)]
            sample_rows.append({
                "id": f"tx-seed-{i+1:03d}",
                "sender": sender,
                "receiver": receiver,
                "amount": round(150.0 + (i * 45.5) % 4500, 2),
                "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=i * 12)).isoformat(),
            })

        # Plant smurfing ring
        shell = "SHELL_OFFSHORE_01"
        shared_ip = "185.220.101.7"
        for i in range(10):
            smurf = f"SMURF{i+1:03d}"
            sample_rows.append({
                "id": f"tx-smurf-{i+1:03d}",
                "sender": smurf,
                "receiver": shell,
                "amount": 9850.00,
                "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=i * 3)).isoformat(),
            })

        # Plant large transaction threshold breach
        sample_rows.append({
            "id": "tx-large-999",
            "sender": "CORP_VAULT_99",
            "receiver": "OFFSHORE_PRIV_88",
            "amount": 75000.00,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        self.add_transactions_bulk(sample_rows)


memory_store = InMemoryStore()
memory_store.seed_default_data_if_empty()
