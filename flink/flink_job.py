"""
Real PyFlink streaming job: Kafka -> stateful windowed aggregation -> Neo4j.

This matches the assignment spec's stack exactly. It needs a JVM and the
Flink Kafka connector jar, which is why it lives separately from
stream_consumer.py (the zero-setup fallback). To run this version:

  1. Install Java 11 and Apache Flink (see ../README.md "Full Flink setup")
  2. pip install apache-flink
  3. Download flink-sql-connector-kafka jar into Flink's /lib
  4. python flink/flink_job.py

The job counts distinct inbound senders per receiving account in 5-minute
tumbling windows — the same starburst signal as the Cypher heuristic, but
computed continuously on the stream instead of on-demand.
"""
import json
import os

from pyflink.datastream import StreamExecutionEnvironment
from pyflink.datastream.connectors.kafka import KafkaSource, KafkaOffsetsInitializer
from pyflink.common.watermark_strategy import WatermarkStrategy
from pyflink.common.serialization import SimpleStringSchema
from pyflink.datastream.window import TumblingProcessingTimeWindows
from pyflink.common.time import Time

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_TRANSACTIONS", "transactions")


def parse_transaction(raw: str):
    tx = json.loads(raw)
    return tx["receiver"], tx["sender"]


def main():
    env = StreamExecutionEnvironment.get_execution_environment()

    source = (
        KafkaSource.builder()
        .set_bootstrap_servers(KAFKA_BOOTSTRAP)
        .set_topics(KAFKA_TOPIC)
        .set_group_id("fingraph-flink")
        .set_starting_offsets(KafkaOffsetsInitializer.latest())
        .set_value_only_deserializer(SimpleStringSchema())
        .build()
    )

    stream = env.from_source(source, WatermarkStrategy.no_watermarks(), "kafka-transactions")

    (
        stream.map(parse_transaction)
        .key_by(lambda pair: pair[0])  # key by receiving account
        .window(TumblingProcessingTimeWindows.of(Time.minutes(5)))
        .apply(lambda key, window, values, out: out.collect(
            (key, len({sender for _, sender in values}))
        ))
        .filter(lambda result: result[1] >= 8)  # 8+ distinct senders in 5 min = flag
        .print()  # replace with a Neo4j sink (see README) to write flags automatically
    )

    env.execute("fingraph-starburst-detection")


if __name__ == "__main__":
    main()
