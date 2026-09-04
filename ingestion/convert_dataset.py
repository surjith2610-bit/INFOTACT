"""
FinGraph Dataset Converter & Fraud Generator.

Converts product/order CSV datasets (order_id, name, brand, sale_price, timestamp, status)
into standard transaction CSV datasets (sender_account, receiver_account, amount, timestamp)
compatible with Kafka, Flink, Neo4j, and FastAPI.
"""

import os
import sys
import argparse
import hashlib
import random
from datetime import datetime, timedelta, timezone
import pandas as pd


def map_entity_to_account(entity_name: str, prefix: str = "ACC") -> str:
    """Deterministically maps a string name/brand to a realistic account ID (e.g., ACC1001)."""
    if pd.isna(entity_name) or not str(entity_name).strip():
        entity_name = "UNKNOWN"
    cleaned = str(entity_name).strip().upper()
    hash_val = int(hashlib.md5(cleaned.encode("utf-8")).hexdigest(), 16) % 9000 + 1000
    return f"{prefix}{hash_val}"


def generate_sample_raw_orders_csv(file_path: str, count: int = 150):
    """Generates a sample raw product/order CSV if none exists."""
    names = ["Alice Smith", "Bob Jones", "Charlie Brown", "Diana Prince", "Evan Wright",
             "Fiona Gallagher", "George Clark", "Hannah Abbott", "Ian Malcolm", "Julia Roberts"]
    brands = ["Apple", "Samsung", "Sony", "Nike", "Adidas", "Dell", "Logitech", "Puma", "Bose", "Asus"]
    statuses = ["COMPLETED", "PENDING", "SHIPPED", "CANCELLED", "PROCESSING"]

    base_time = datetime.now(timezone.utc) - timedelta(days=3)
    rows = []
    for i in range(1, count + 1):
        order_id = f"ORD-{i:05d}"
        name = random.choice(names)
        brand = random.choice(brands)
        sale_price = round(random.uniform(25.0, 1800.0), 2)
        ts = (base_time + timedelta(minutes=random.randint(1, 4000))).isoformat()
        status = random.choice(statuses)
        rows.append({
            "order_id": order_id,
            "name": name,
            "brand": brand,
            "sale_price": sale_price,
            "timestamp": ts,
            "status": status
        })

    df = pd.DataFrame(rows)
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    df.to_csv(file_path, index=False)
    print(f"[CONVERTER] Generated sample raw order CSV at: {file_path} ({len(df)} rows)")


def convert_and_enrich_dataset(
    input_csv_path: str,
    output_csv_path: str,
    target_min_rows: int = 1000,
    inject_fraud: bool = True,
    exchange_rate: float = 83.0,
) -> pd.DataFrame:
    """
    Reads order CSV, intelligently maps columns to transaction schema,
    enriches with synthetic fraud patterns, converts currency to INR using exchange_rate (default 83.0),
    and outputs clean CSV with columns: sender_account, receiver_account, amount, timestamp
    """
    if not os.path.exists(input_csv_path):
        print(f"[CONVERTER] Input file {input_csv_path} not found. Generating sample input CSV...")
        generate_sample_raw_orders_csv(input_csv_path, count=150)

    print(f"[CONVERTER] Reading input CSV: {input_csv_path}")
    raw_df = pd.read_csv(input_csv_path)

    # 1. Map columns intelligently
    mapped_rows = []
    for idx, row in raw_df.iterrows():
        # Sender account from 'name' or fallback
        raw_name = row.get("name") or row.get("sender_account") or row.get("sender") or f"Customer_{idx}"
        sender_acc = map_entity_to_account(raw_name, prefix="ACC1")

        # Receiver account from 'brand' or fallback
        raw_brand = row.get("brand") or row.get("receiver_account") or row.get("receiver") or f"Vendor_{idx}"
        receiver_acc = map_entity_to_account(raw_brand, prefix="ACC2")

        # Amount from 'sale_price' or fallback
        raw_price = row.get("sale_price") or row.get("amount") or 100.0
        try:
            val_str = str(raw_price).replace("₹", "").replace("$", "").replace(",", "").strip()
            amount = round(float(val_str) * (exchange_rate if "$" in str(raw_price) or float(val_str) < 5000 else 1.0), 2)
            if amount <= 0:
                amount = 4150.0
        except (ValueError, TypeError):
            amount = 4150.0

        # Timestamp
        ts_val = str(row.get("timestamp") or datetime.now(timezone.utc).isoformat()).strip()

        mapped_rows.append({
            "sender_account": sender_acc,
            "receiver_account": receiver_acc,
            "amount": amount,
            "timestamp": ts_val
        })

    tx_df = pd.DataFrame(mapped_rows)
    print(f"[CONVERTER] Converted {len(tx_df)} rows from order schema to transaction schema (INR scale).")

    # 2. Enrich with synthetic rows if total < target_min_rows or fraud injection requested
    rows_needed = max(0, target_min_rows - len(tx_df))
    if rows_needed > 0 or inject_fraud:
        print(f"[CONVERTER] Enriching dataset to {target_min_rows}+ rows with realistic fraud patterns (INR scale)...")
        synthetic_rows = []
        base_time = datetime.now(timezone.utc) - timedelta(days=2)

        # Account pools
        normal_senders = [f"ACC1{i:03d}" for i in range(100, 150)]
        normal_receivers = [f"ACC2{i:03d}" for i in range(100, 150)]

        # --- Pattern A: Normal Transactions (~75% of synthetic additions) ---
        num_normal = int(rows_needed * 0.75) if rows_needed > 0 else 700
        for _ in range(num_normal):
            s = random.choice(normal_senders)
            r = random.choice(normal_receivers)
            amt = round(random.uniform(12.50, 4500.00) * exchange_rate, 2)
            ts = (base_time + timedelta(minutes=random.randint(0, 2880))).isoformat()
            synthetic_rows.append({
                "sender_account": s,
                "receiver_account": r,
                "amount": amt,
                "timestamp": ts
            })

        # --- Pattern B: Smurfing / Starburst Ring (~15% of synthetic additions) ---
        # Multiple smurf accounts sending small amounts under ₹8,30,000 ($10k) threshold to one shell receiver
        num_smurf_tx = int(rows_needed * 0.15) if rows_needed > 0 else 150
        target_shell = "ACC_SHELL01"
        smurf_accounts = [f"ACC_SMURF{i:03d}" for i in range(1, 21)]
        smurf_start_time = base_time + timedelta(hours=14)

        for i in range(num_smurf_tx):
            smurf_sender = smurf_accounts[i % len(smurf_accounts)]
            smurf_amt = round(random.uniform(8900.00, 9950.00) * exchange_rate, 2) # just under ₹8.3L SAR threshold
            smurf_ts = (smurf_start_time + timedelta(seconds=i * 45)).isoformat()
            synthetic_rows.append({
                "sender_account": smurf_sender,
                "receiver_account": target_shell,
                "amount": smurf_amt,
                "timestamp": smurf_ts
            })

        # --- Pattern C: Large Sudden Transfers (~5% of synthetic additions) ---
        num_large = int(rows_needed * 0.05) if rows_needed > 0 else 50
        for i in range(num_large):
            s = random.choice(normal_senders)
            r = random.choice(normal_receivers)
            large_amt = round(random.uniform(55000.00, 250000.00) * exchange_rate, 2)
            large_ts = (base_time + timedelta(hours=random.randint(1, 48))).isoformat()
            synthetic_rows.append({
                "sender_account": s,
                "receiver_account": r,
                "amount": large_amt,
                "timestamp": large_ts
            })

        # --- Pattern D: Circular Laundering Loops (~5% of synthetic additions) ---
        # Loop: ACC_LOOP01 -> ACC_LOOP02 -> ACC_LOOP03 -> ACC_LOOP01
        loop_accounts = ["ACC_LOOP01", "ACC_LOOP02", "ACC_LOOP03"]
        loop_start_time = base_time + timedelta(hours=20)
        num_loops = max(10, int(rows_needed * 0.05)) if rows_needed > 0 else 30
        for i in range(num_loops):
            step = i % 3
            src = loop_accounts[step]
            dst = loop_accounts[(step + 1) % 3]
            loop_amt = round((12000.00 - (step * 250.0)) * exchange_rate, 2)
            loop_ts = (loop_start_time + timedelta(minutes=i * 15)).isoformat()
            synthetic_rows.append({
                "sender_account": src,
                "receiver_account": dst,
                "amount": loop_amt,
                "timestamp": loop_ts
            })

        synth_df = pd.DataFrame(synthetic_rows)
        tx_df = pd.concat([tx_df, synth_df], ignore_index=True)

    # 3. Final Cleanup & Formatting
    # Keep ONLY the 4 target columns in exact order
    target_columns = ["sender_account", "receiver_account", "amount", "timestamp"]
    tx_df = tx_df[target_columns]

    # Ensure amount is float formatted
    tx_df["amount"] = tx_df["amount"].astype(float).round(2)

    # Ensure no null / missing values
    tx_df["sender_account"] = tx_df["sender_account"].fillna("ACC_UNKNOWN_S")
    tx_df["receiver_account"] = tx_df["receiver_account"].fillna("ACC_UNKNOWN_R")
    tx_df["amount"] = tx_df["amount"].fillna(0.0)
    tx_df["timestamp"] = tx_df["timestamp"].fillna(datetime.now(timezone.utc).isoformat())

    # Shuffle to interleave converted and synthetic data naturally
    tx_df = tx_df.sample(frac=1.0, random_state=42).reset_index(drop=True)

    # Output CSV
    os.makedirs(os.path.dirname(os.path.abspath(output_csv_path)), exist_ok=True)
    tx_df.to_csv(output_csv_path, index=False)

    print(f"\n[CONVERTER SUCCESS]")
    print(f"Total Rows Outputted: {len(tx_df)}")
    print(f"Null Values Count: {tx_df.isna().sum().sum()}")
    print(f"Saved Clean CSV to: {output_csv_path}")

    return tx_df


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert Order CSV to FinGraph Transaction CSV")
    parser.add_argument("--input", type=str, default="data/raw_orders.csv", help="Input raw CSV path")
    parser.add_argument("--output", type=str, default="data/converted_transactions.csv", help="Output transaction CSV path")
    parser.add_argument("--min-rows", type=int, default=1050, help="Minimum target rows for synthetic scaling")
    parser.add_argument("--no-fraud", action="store_true", help="Disable synthetic fraud injection")

    args = parser.parse_args()

    df_res = convert_and_enrich_dataset(
        input_csv_path=args.input,
        output_csv_path=args.output,
        target_min_rows=args.min_rows,
        inject_fraud=not args.no_fraud
    )

    print("\n--- DATASET SAMPLE PREVIEW (First 10 Rows) ---")
    print(df_res.head(10).to_string(index=False))
