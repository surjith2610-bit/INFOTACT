"""
Sub-Second Latency Benchmark & Verification Script.
Proves that a transaction sent to Kafka appears as a connected edge in Neo4j in under 1 second.
"""
import os
import time
import json
import uuid
import logging
from datetime import datetime, timezone
from kafka import KafkaProducer
from neo4j import GraphDatabase

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("latency_verify")

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_TRANSACTIONS", "fingraph-transactions")

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "fingraph123")
NEO4J_DB = os.getenv("NEO4J_DATABASE", "neo4j")


def test_streaming_latency(timeout_sec: float = 5.0) -> float:
    """Sends a benchmark transaction to Kafka and measures time until edge appears in Neo4j."""
    benchmark_id = f"TX-BENCH-{str(uuid.uuid4())[:8]}"
    sender = "BENCH_SENDER_01"
    receiver = "BENCH_RECEIVER_01"
    amount = 4999.99

    payload = {
        "txId": benchmark_id,
        "sender": sender,
        "receiver": receiver,
        "amount": amount,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sender_person": "Bench Person A",
        "receiver_person": "Bench Person B",
        "sender_bank": "Bank Test A",
        "receiver_bank": "Bank Test B",
    }

    # 1. Connect to Kafka & Neo4j
    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    # 2. Record start timestamp T1 and produce message
    t1 = time.perf_counter()
    producer.send(KAFKA_TOPIC, value=payload)
    producer.flush()
    logger.info(f"[BENCHMARK] Transaction '{benchmark_id}' sent to Kafka topic '{KAFKA_TOPIC}' at t=0.000s")

    # 3. Poll Neo4j until edge appears
    cypher_check = """
    MATCH (s:Account {accountId: $sender})-[t:TRANSFERRED_TO|TRANSFER {txId: $txId}]->(r:Account {accountId: $receiver})
    RETURN t.txId AS txId, t.amount AS amount
    """

    found = False
    elapsed = 0.0

    with driver.session(database=NEO4J_DB) as session:
        while (time.perf_counter() - t1) < timeout_sec:
            res = session.run(cypher_check, {"sender": sender, "receiver": receiver, "txId": benchmark_id})
            records = list(res)
            if len(records) > 0:
                t2 = time.perf_counter()
                elapsed = (t2 - t1) * 1000.0  # ms
                found = True
                break
            time.sleep(0.01)  # 10ms poll resolution

    producer.close()
    driver.close()

    if found:
        logger.info(f"[BENCHMARK PASS] Connected edge appeared in Neo4j in {elapsed:.2f} ms (< 1000 ms target).")
        assert elapsed < 1000.0, f"Latency breached target: {elapsed:.2f} ms >= 1000 ms"
        return elapsed
    else:
        logger.error(f"[BENCHMARK FAIL] Transaction edge '{benchmark_id}' did not appear in Neo4j within {timeout_sec}s.")
        raise TimeoutError(f"Benchmark transaction '{benchmark_id}' timed out after {timeout_sec} seconds.")


if __name__ == "__main__":
    try:
        latency_ms = test_streaming_latency()
        print(f"\nSUCCESS: End-to-end streaming ingestion latency = {latency_ms:.2f} ms\n")
    except Exception as err:
        print(f"\nFAILURE: Latency benchmark error: {err}\n")
