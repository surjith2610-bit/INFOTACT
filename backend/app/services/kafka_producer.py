import time
import json
import logging
from app.config import settings

logger = logging.getLogger("kafka_producer")
_producer = None
_last_failed_time = 0.0


def _get_producer():
    global _producer, _last_failed_time
    if _producer is not None:
        return _producer

    # Cooldown check: if Kafka connection failed recently, wait 10s before retrying
    if time.time() - _last_failed_time < 10.0:
        return None

    try:
        from kafka import KafkaProducer
        from kafka.admin import KafkaAdminClient, NewTopic

        # Attempt connection
        _producer = KafkaProducer(
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            request_timeout_ms=1000,
            retries=0,
        )
        logger.info(f"[KAFKA] Producer connected to {settings.KAFKA_BOOTSTRAP_SERVERS}")

        # Ensure topic exists
        try:
            admin = KafkaAdminClient(
                bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS,
                request_timeout_ms=1000,
            )
            existing_topics = admin.list_topics()
            if settings.KAFKA_TOPIC_TRANSACTIONS not in existing_topics:
                new_topic = NewTopic(
                    name=settings.KAFKA_TOPIC_TRANSACTIONS,
                    num_partitions=1,
                    replication_factor=1,
                )
                admin.create_topics([new_topic])
                logger.info(f"[KAFKA] Topic ready: '{settings.KAFKA_TOPIC_TRANSACTIONS}' created")
            else:
                logger.info(f"[KAFKA] Topic ready: '{settings.KAFKA_TOPIC_TRANSACTIONS}' verified")
            admin.close()
        except Exception as te:
            logger.debug(f"[KAFKA] Topic verification check: {te}")

    except Exception as e:
        _last_failed_time = time.time()
        logger.warning(
            f"[KAFKA] Unable to connect to Kafka at {settings.KAFKA_BOOTSTRAP_SERVERS}: {e}. "
            f"Direct graph storage will proceed."
        )
        _producer = None

    return _producer


def publish_transaction(transaction: dict) -> bool:
    """
    Publishes a single transaction payload to the configured Kafka transactions topic.
    Returns True if successfully pushed, False otherwise.
    """
    producer = _get_producer()
    if producer is None:
        return False
    try:
        future = producer.send(settings.KAFKA_TOPIC_TRANSACTIONS, transaction)
        producer.flush(timeout=2)
        logger.info(f"[KAFKA] Transaction published: txId={transaction.get('txId')}")
        return True
    except Exception as e:
        logger.warning(f"[KAFKA] Failed to publish transaction: {e}")
        return False
