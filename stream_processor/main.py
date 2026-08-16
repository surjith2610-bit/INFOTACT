"""
FinGraph Real-Time Stream Processor
Consumes transaction events from Kafka topic, evaluates fraud rules,
and persists alerts and updates into the Neo4j graph database.
"""
import os
import json
import time
import logging
import uuid
from datetime import datetime, timezone
from kafka import KafkaConsumer
from kafka.admin import KafkaAdminClient, NewTopic
from neo4j import GraphDatabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("stream_processor")

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_TRANSACTIONS", "fingraph-transactions")
KAFKA_GROUP = os.getenv("KAFKA_GROUP_ID", "fingraph-stream-processor")

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "fingraph123")
NEO4J_DB = os.getenv("NEO4J_DATABASE", "neo4j")

# In-memory window tracking for velocity detection
_receiver_window: dict[str, list] = {}
BURST_THRESHOLD = 5


def connect_kafka_consumer() -> KafkaConsumer:
    """Retries Kafka consumer connection until broker is ready."""
    max_retries = 15
    for attempt in range(1, max_retries + 1):
        try:
            # Ensure topic exists
            try:
                admin = KafkaAdminClient(
                    bootstrap_servers=KAFKA_BOOTSTRAP,
                    request_timeout_ms=3000,
                )
                if KAFKA_TOPIC not in admin.list_topics():
                    admin.create_topics([NewTopic(name=KAFKA_TOPIC, num_partitions=1, replication_factor=1)])
                    logger.info(f"[KAFKA] Topic ready: '{KAFKA_TOPIC}' created")
                else:
                    logger.info(f"[KAFKA] Topic ready: '{KAFKA_TOPIC}' verified")
                admin.close()
            except Exception as te:
                logger.debug(f"[KAFKA] Topic verification check: {te}")

            consumer = KafkaConsumer(
                KAFKA_TOPIC,
                bootstrap_servers=KAFKA_BOOTSTRAP,
                group_id=KAFKA_GROUP,
                auto_offset_reset="latest",
                value_deserializer=lambda v: json.loads(v.decode("utf-8")),
                enable_auto_commit=True,
            )
            logger.info(f"[KAFKA] Connected to {KAFKA_BOOTSTRAP} listening on '{KAFKA_TOPIC}'")
            return consumer
        except Exception as e:
            logger.warning(f"[KAFKA] Connection attempt {attempt}/{max_retries} failed: {e}")
            if attempt == max_retries:
                logger.error("[KAFKA] Could not connect to Kafka broker. Exiting.")
                raise e
            time.sleep(3)


def get_neo4j_driver():
    """Initializes Neo4j driver with retry logic."""
    max_retries = 15
    for attempt in range(1, max_retries + 1):
        try:
            driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
            driver.verify_connectivity()
            logger.info(f"[NEO4J] Connected successfully to {NEO4J_URI}")
            return driver
        except Exception as e:
            logger.warning(f"[NEO4J] Connection attempt {attempt}/{max_retries} failed: {e}")
            if attempt == max_retries:
                logger.error("[NEO4J] Could not connect to Neo4j database.")
                raise e
            time.sleep(3)


def process_transaction(tx: dict, driver):
    """Processes incoming stream event, updates graph, and evaluates real-time rules."""
    sender = str(tx.get("sender") or tx.get("sender_account") or "").strip()
    receiver = str(tx.get("receiver") or tx.get("receiver_account") or "").strip()

    if not sender or not receiver:
        logger.warning(f"[KAFKA] Skipped invalid transaction payload: {tx}")
        return

    tx_id = str(tx.get("txId") or tx.get("transaction_id") or uuid.uuid4())
    sender_person = str(tx.get("sender_person") or f"Person_{sender}").strip()
    receiver_person = str(tx.get("receiver_person") or f"Person_{receiver}").strip()
    sender_bank = str(tx.get("sender_bank") or "Bank_Default").strip()
    receiver_bank = str(tx.get("receiver_bank") or "Bank_Default").strip()
    sender_ip = str(tx.get("sender_ip") or "").strip()
    receiver_ip = str(tx.get("receiver_ip") or "").strip()

    try:
        amount = float(tx.get("amount", 0))
    except (ValueError, TypeError):
        amount = 0.0

    timestamp = str(tx.get("timestamp") or datetime.now(timezone.utc).isoformat())

    logger.info(f"[KAFKA] Transaction received: {sender} ({sender_person}) -> {receiver} ({receiver_person}) (${amount:,.2f})")

    # 1. Update Neo4j graph synchronously (Accounts, Persons, Banks, Edges)
    cypher_write = """
    MERGE (sp:Person {personId: $senderPerson})
    MERGE (rp:Person {personId: $receiverPerson})
    MERGE (sb:Bank {bankId: $senderBank})
    MERGE (rb:Bank {bankId: $receiverBank})

    MERGE (s:Account {accountId: $sender})
    MERGE (r:Account {accountId: $receiver})

    MERGE (sp)-[:OWNS]->(s)
    MERGE (rp)-[:OWNS]->(r)
    MERGE (s)-[:HELD_AT]->(sb)
    MERGE (r)-[:HELD_AT]->(rb)

    MERGE (s)-[t:TRANSFERRED_TO {txId: $txId}]->(r)
    ON CREATE SET t.amount = $amount, t.timestamp = $timestamp

    MERGE (s)-[t_legacy:TRANSFER {txId: $txId}]->(r)
    ON CREATE SET t_legacy.amount = $amount, t_legacy.timestamp = $timestamp
    """
    params = {
        "sender": sender,
        "receiver": receiver,
        "txId": tx_id,
        "amount": amount,
        "timestamp": timestamp,
        "senderPerson": sender_person,
        "receiverPerson": receiver_person,
        "senderBank": sender_bank,
        "receiverBank": receiver_bank,
    }

    with driver.session(database=NEO4J_DB) as session:
        session.run(cypher_write, params)

        # Connect SHARED_IP edges if IP addresses exist and match or link to IP node
        if sender_ip and receiver_ip and sender_ip == receiver_ip:
            cypher_ip = """
            MATCH (s:Account {accountId: $sender})
            MATCH (r:Account {accountId: $receiver})
            MERGE (s)-[:SHARED_IP {ip: $ip}]->(r)
            """
            session.run(cypher_ip, {"sender": sender, "receiver": receiver, "ip": sender_ip})


    # 2. Evaluate real-time streaming burst / smurfing rule
    if receiver not in _receiver_window:
        _receiver_window[receiver] = []
    _receiver_window[receiver].append({"sender": sender, "amount": amount, "timestamp": timestamp, "txId": tx_id})

    # Keep window within last 50 events
    _receiver_window[receiver] = _receiver_window[receiver][-50:]
    unique_senders = {item["sender"] for item in _receiver_window[receiver]}

    if len(unique_senders) >= BURST_THRESHOLD:
        alert_id = f"ALT-STREAM-{receiver}-{len(unique_senders)}"
        desc = f"[REAL-TIME ALERT] Account {receiver} received streaming transfers from {len(unique_senders)} distinct senders."
        logger.info(f"[KAFKA] Fraud detected: {desc}")

        cypher_alert = """
        MERGE (fa:FraudAlert {id: $alertId})
        ON CREATE SET fa.type = 'STREAMING_SMURFING_BURST',
                      fa.severity = 'HIGH',
                      fa.description = $desc,
                      fa.createdAt = datetime()
        WITH fa
        UNWIND $accs AS accId
        MERGE (a:Account {accountId: accId})
        MERGE (fa)-[:INVOLVES]->(a)
        """
        all_accs = list(unique_senders) + [receiver]
        with driver.session(database=NEO4J_DB) as session:
            session.run(cypher_alert, {"alertId": alert_id, "desc": desc, "accs": all_accs})


def main():
    logger.info("[STREAM PROCESSOR] Starting FinGraph Kafka stream consumer worker...")
    driver = get_neo4j_driver()
    consumer = connect_kafka_consumer()

    try:
        for message in consumer:
            try:
                tx_data = message.value
                if isinstance(tx_data, dict):
                    process_transaction(tx_data, driver)
                else:
                    logger.warning(f"[KAFKA] Received non-dict payload: {tx_data}")
            except Exception as record_err:
                logger.error(f"[KAFKA] Error processing record offset {message.offset}: {record_err}")
                continue
    except KeyboardInterrupt:
        logger.info("[STREAM PROCESSOR] Stopping worker...")
    finally:
        consumer.close()
        driver.close()
        logger.info("[STREAM PROCESSOR] Worker shutdown complete.")


if __name__ == "__main__":
    main()
