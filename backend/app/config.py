"""
Central configuration for FinGraph backend.
Reads configuration from environment variables with sensible defaults.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # --- App ---
    APP_NAME: str = "FinGraph"
    ENV: str = "development"
    PORT: int = 5001

    # --- Neo4j (the fraud graph) ---
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "fingraph123"
    NEO4J_DATABASE: str = "neo4j"

    # --- Kafka ---
    KAFKA_BOOTSTRAP_SERVERS: str = "localhost:9092"
    KAFKA_TOPIC_TRANSACTIONS: str = "fingraph-transactions"
    KAFKA_GROUP_ID: str = "fingraph-stream-processor"

    # --- Ingestion & Seed ---
    DATA_PATH: str = "./data/sample_transactions.csv"
    SEED_DATA: bool = True

    # --- Fraud Detection Rule Thresholds ---
    SMURFING_TRANSACTION_LIMIT: int = 5
    SMURFING_WINDOW_MINUTES: int = 60
    CIRCULAR_MAX_DEPTH: int = 3
    HIGH_FREQUENCY_COUNT: int = 10
    HIGH_FREQUENCY_WINDOW_MINUTES: int = 15
    LARGE_TRANSACTION_THRESHOLD: float = 10000.0

    # --- Frontend origin (CORS) ---
    FRONTEND_ORIGIN: str = "http://localhost:5173"

    # --- SMTP (Email Fraud Alerts) ---
    SMTP_USER: str = ""
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@fingraph.io"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
