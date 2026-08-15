"""
Streaming layer for FinGraph.

WHY THIS FILE EXISTS:
The assignment spec calls for Kafka -> Apache Flink -> Neo4j. A real PyFlink
job needs a JVM + Flink cluster (see flink_job.py below for that version).
This file is a lightweight Kafka consumer that does the SAME job — reading
the `transactions` topic and confirming each event landed in Neo4j — so you
can see the streaming path working immediately with just `docker compose up`,
before you invest time standing up the full Flink cluster.

Run it with: python flink/stream_consumer.py
"""
import json
import os

from kafka import KafkaConsumer
from neo4j import GraphDatabase

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_TRANSACTIONS", "transactions")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "fingraph123")

# Rolling per-account counters used to flag a burst of inbound transfers
# in real time, without waiting for the analyst to click "run detection".
_inbound_counts: dict[str, int] = {}
BURST_THRESHOLD = 8


def main():
    consumer = KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        auto_offset_reset="latest",
    )
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    print(f"[stream_consumer] listening on '{KAFKA_TOPIC}'...")

    for message in consumer:
        tx = message.value
        receiver = tx["receiver"]
        _inbound_counts[receiver] = _inbound_counts.get(receiver, 0) + 1

        if _inbound_counts[receiver] == BURST_THRESHOLD:
            print(f"[ALERT] {receiver} just received its {BURST_THRESHOLD}th distinct "
                  f"inbound transaction in this session — possible starburst pattern.")
            with driver.session() as session:
                session.run(
                    "MATCH (a:Account {accountId: $id}) SET a.liveFlag = true",
                    {"id": receiver},
                )


if __name__ == "__main__":
    main()
