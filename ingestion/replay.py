"""
FinGraph Continuous Transaction Stream Producer (Replay Script).
Streams IBM AML Kaggle / PaySim / synthetic transaction rows into Kafka topic at controlled rate.
"""
import os
import time
import json
import logging
import argparse
from datetime import datetime, timezone
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable

try:
    from csv_parser import parse_csv_file
except ImportError:
    from ingestion.csv_parser import parse_csv_file

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ingestion_replay")

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_TRANSACTIONS", "fingraph-transactions")


def get_kafka_producer(bootstrap_servers: str) -> KafkaProducer:
    """Connects to Kafka broker with retries."""
    max_retries = 10
    for attempt in range(1, max_retries + 1):
        try:
            producer = KafkaProducer(
                bootstrap_servers=bootstrap_servers,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                acks="all",
            )
            logger.info(f"[REPLAY] Connected to Kafka broker at {bootstrap_servers}")
            return producer
        except NoBrokersAvailable:
            logger.warning(f"[REPLAY] Kafka unavailable (attempt {attempt}/{max_retries}). Retrying in 3s...")
            if attempt == max_retries:
                raise
            time.sleep(3)


def replay_transactions(
    csv_file: str,
    rate_per_sec: float = 2.0,
    loop: bool = False,
    bootstrap_servers: str = KAFKA_BOOTSTRAP,
):
    """Replays transactions from CSV dataset into Kafka stream topic."""
    logger.info(f"[REPLAY] Parsing dataset file: {csv_file}")
    transactions = parse_csv_file(csv_file)
    logger.info(f"[REPLAY] Loaded {len(transactions)} transaction records.")

    producer = get_kafka_producer(bootstrap_servers)
    interval = 1.0 / rate_per_sec if rate_per_sec > 0 else 0

    sent_count = 0
    try:
        while True:
            for idx, tx in enumerate(transactions, start=1):
                if not tx.get("timestamp"):
                    tx["timestamp"] = datetime.now(timezone.utc).isoformat()

                producer.send(KAFKA_TOPIC, value=tx)
                producer.flush()
                sent_count += 1
                logger.info(
                    f"[REPLAY #{sent_count}] Sent tx '{tx['txId']}': "
                    f"{tx['sender']} -> {tx['receiver']} (${tx['amount']:,.2f})"
                )

                if interval > 0:
                    time.sleep(interval)

            if not loop:
                break
            logger.info("[REPLAY] Reached end of dataset. Looping stream replay...")

    except KeyboardInterrupt:
        logger.info("[REPLAY] Replay stream stopped by user.")
    finally:
        producer.close()
        logger.info(f"[REPLAY] Finished. Total transactions published to Kafka: {sent_count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FinGraph Stream Replay Script")
    parser.add_argument("--csv", type=str, default="data/sample_transactions.csv", help="Path to CSV dataset file")
    parser.add_argument("--rate", type=float, default=2.0, help="Transactions per second")
    parser.add_argument("--loop", action="store_true", help="Loop dataset infinitely")
    parser.add_argument("--kafka", type=str, default=KAFKA_BOOTSTRAP, help="Kafka bootstrap server host:port")

    args = parser.parse_args()
    replay_transactions(
        csv_file=args.csv,
        rate_per_sec=args.rate,
        loop=args.loop,
        bootstrap_servers=args.kafka,
    )
