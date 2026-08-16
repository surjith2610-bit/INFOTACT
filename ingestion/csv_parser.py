"""
CSV Dataset Parser and Normalizer for FinGraph Ingestion.
Normalizes incoming transaction rows into standard FinGraph schema.
"""
import pandas as pd
from typing import List, Dict, Any


def normalize_transaction_row(row: Dict[str, Any], index: int = 0) -> Dict[str, Any]:
    """
    Normalizes arbitrary CSV column headers into standardized FinGraph transaction dictionary.
    Supports IBM AML Kaggle dataset, PaySim format, and FinGraph sample CSV.
    """
    # 1. Transaction ID
    tx_id = str(
        row.get("transaction_id")
        or row.get("txId")
        or row.get("id")
        or f"TX-{index:06d}"
    ).strip()

    # 2. Sender Account & Details
    sender = str(
        row.get("sender_account")
        or row.get("sender")
        or row.get("nameOrig")
        or row.get("From Bank Account")
        or f"ACC_S_{index}"
    ).strip()

    sender_person = str(
        row.get("sender_person")
        or row.get("sender_name")
        or row.get("From Customer")
        or f"Person_{sender}"
    ).strip()

    sender_bank = str(
        row.get("sender_bank")
        or row.get("From Bank")
        or "Bank_Alpha"
    ).strip()

    sender_ip = str(
        row.get("sender_ip")
        or row.get("ip_address")
        or ""
    ).strip()

    # 3. Receiver Account & Details
    receiver = str(
        row.get("receiver_account")
        or row.get("receiver")
        or row.get("nameDest")
        or row.get("To Bank Account")
        or f"ACC_R_{index}"
    ).strip()

    receiver_person = str(
        row.get("receiver_person")
        or row.get("receiver_name")
        or row.get("To Customer")
        or f"Person_{receiver}"
    ).strip()

    receiver_bank = str(
        row.get("receiver_bank")
        or row.get("To Bank")
        or "Bank_Beta"
    ).strip()

    receiver_ip = str(
        row.get("receiver_ip")
        or row.get("ip_address")
        or ""
    ).strip()

    # 4. Amount
    raw_amount = row.get("amount") or row.get("Amount Paid") or row.get("amountReceived") or 0.0
    try:
        amount = float(raw_amount)
    except (ValueError, TypeError):
        amount = 0.0

    # 5. Timestamp
    timestamp = str(
        row.get("timestamp")
        or row.get("Timestamp")
        or row.get("date")
        or ""
    ).strip()

    return {
        "txId": tx_id,
        "sender": sender,
        "sender_person": sender_person,
        "sender_bank": sender_bank,
        "sender_ip": sender_ip,
        "receiver": receiver,
        "receiver_person": receiver_person,
        "receiver_bank": receiver_bank,
        "receiver_ip": receiver_ip,
        "amount": amount,
        "timestamp": timestamp,
        "is_laundering": int(row.get("Is Laundering") or row.get("isFraud") or row.get("is_laundering") or 0),
    }


def parse_csv_file(file_path: str) -> List[Dict[str, Any]]:
    """Reads CSV file and returns list of normalized transaction dictionaries."""
    df = pd.read_csv(file_path)
    records = df.to_dict(orient="records")
    return [normalize_transaction_row(r, idx) for idx, r in enumerate(records)]
