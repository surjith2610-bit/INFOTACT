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

    @staticmethod
    def derive_account_meta(acc_id: str, name: str = None, bank: str = None) -> dict:
        if not acc_id:
            return {"id": "", "name": "Unknown", "bank": "Unknown Bank"}
        
        known_meta = {
            "ACC0001": {"name": "Alice Smith", "bank": "HDFC Bank"},
            "ACC0002": {"name": "Bob Jones", "bank": "State Bank of India"},
            "ACC0003": {"name": "Charlie Brown", "bank": "ICICI Bank"},
            "ACC0004": {"name": "Diana Prince", "bank": "Axis Bank"},
            "ACC0005": {"name": "Evan Wright", "bank": "Kotak Mahindra Bank"},
            "SMURF001": {"name": "Smurf Mule 1", "bank": "Global Offshore Bank"},
            "SMURF002": {"name": "Smurf Mule 2", "bank": "Global Offshore Bank"},
            "SMURF003": {"name": "Smurf Mule 3", "bank": "Global Offshore Bank"},
            "SHELL01": {"name": "Offshore Holding Ltd", "bank": "Cayman Reserve Bank"},
            "CIRCULAR_HUB": {"name": "Apex Transfers Inc", "bank": "HSBC Bank"},
        }
        
        if acc_id in known_meta:
            meta = known_meta[acc_id]
            return {
                "id": acc_id,
                "name": name or meta["name"],
                "bank": bank or meta["bank"]
            }

        banks = ["HDFC Bank", "State Bank of India", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "HSBC Bank", "Punjab National Bank"]
        bank_idx = abs(hash(acc_id)) % len(banks)
        default_name = f"Account {acc_id}" if not name else name
        default_bank = banks[bank_idx] if not bank else bank
        
        return {
            "id": acc_id,
            "name": default_name,
            "bank": default_bank
        }

    def get_accounts(self, limit: int = 100) -> list[dict]:
        accounts_map = {}
        for tx in self.transactions:
            s = tx.get("sender")
            r = tx.get("receiver")
            if s:
                if s not in accounts_map:
                    meta = self.derive_account_meta(s, tx.get("sender_name"), tx.get("sender_bank"))
                    accounts_map[s] = {"id": s, "name": meta["name"], "bank": meta["bank"], "outbound_count": 0, "inbound_count": 0, "risk_score": 0.0}
                accounts_map[s]["outbound_count"] += 1
            if r:
                if r not in accounts_map:
                    meta = self.derive_account_meta(r, tx.get("receiver_name"), tx.get("receiver_bank"))
                    accounts_map[r] = {"id": r, "name": meta["name"], "bank": meta["bank"], "outbound_count": 0, "inbound_count": 0, "risk_score": 0.0}
                accounts_map[r]["inbound_count"] += 1

        acc_list = list(accounts_map.values())
        acc_list.sort(key=lambda x: x["inbound_count"] + x["outbound_count"], reverse=True)
        return acc_list[:limit]

    def get_transaction_trace(self, account_id: str) -> dict:
        acc_meta = self.derive_account_meta(account_id)
        incoming = []
        outgoing = []
        tot_in = 0.0
        tot_out = 0.0

        for tx in self.transactions:
            tx_id = str(tx.get("id") or tx.get("txId") or "")
            s_id = str(tx.get("sender") or "")
            r_id = str(tx.get("receiver") or "")
            amt = float(tx.get("amount", 0.0))
            ts = str(tx.get("timestamp") or "")

            s_meta = self.derive_account_meta(s_id, tx.get("sender_name"), tx.get("sender_bank"))
            r_meta = self.derive_account_meta(r_id, tx.get("receiver_name"), tx.get("receiver_bank"))

            if r_id == account_id:
                tot_in += amt
                incoming.append({
                    "transaction_id": tx_id,
                    "from_account": s_id,
                    "from_name": s_meta["name"],
                    "from_bank": s_meta["bank"],
                    "to_account": r_id,
                    "to_name": acc_meta["name"],
                    "to_bank": acc_meta["bank"],
                    "amount": amt,
                    "timestamp": ts,
                    "is_suspicious": amt >= 9000 and amt < 10000,
                })
            elif s_id == account_id:
                tot_out += amt
                outgoing.append({
                    "transaction_id": tx_id,
                    "to_account": r_id,
                    "to_name": r_meta["name"],
                    "to_bank": r_meta["bank"],
                    "from_account": s_id,
                    "from_name": acc_meta["name"],
                    "from_bank": acc_meta["bank"],
                    "amount": amt,
                    "timestamp": ts,
                    "is_suspicious": amt >= 9000 and amt < 10000,
                })

        return {
            "account": acc_meta,
            "incoming": incoming,
            "outgoing": outgoing,
            "incoming_transactions": incoming,
            "outgoing_transactions": outgoing,
            "total_incoming": round(tot_in, 2),
            "total_outgoing": round(tot_out, 2)
        }

    def get_graph_data(self, limit: int = 300) -> dict:
        nodes = {}
        links = []
        tx_slice = self.transactions[:limit]

        for tx in tx_slice:
            s = str(tx.get("sender", ""))
            r = str(tx.get("receiver", ""))
            amt = float(tx.get("amount", 0.0))
            tx_id = str(tx.get("id") or tx.get("txId") or "")

            s_meta = self.derive_account_meta(s, tx.get("sender_name"), tx.get("sender_bank"))
            r_meta = self.derive_account_meta(r, tx.get("receiver_name"), tx.get("receiver_bank"))

            if s:
                nodes[s] = {"id": s, "name": s_meta["name"], "bank": s_meta["bank"], "risk": 0.0}
            if r:
                nodes[r] = {"id": r, "name": r_meta["name"], "bank": r_meta["bank"], "risk": 0.0}

            if s and r:
                links.append({"source": s, "target": r, "amount": amt, "txId": tx_id, "timestamp": tx.get("timestamp")})

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
