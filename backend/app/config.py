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

    # --- Currency & Conversion ---
    CURRENCY: str = "INR"
    EXCHANGE_RATE: float = 83.0

    # --- Fraud Detection Rule Thresholds ---
    SMURFING_TRANSACTION_LIMIT: int = 5
    SMURFING_WINDOW_MINUTES: int = 60
    CIRCULAR_MAX_DEPTH: int = 5
    HIGH_FREQUENCY_COUNT: int = 10
    HIGH_FREQUENCY_WINDOW_MINUTES: int = 15
    LARGE_TRANSACTION_THRESHOLD: float = 830000.0  # ₹8,30,000 (~$10k SAR threshold * 83)
    SMURFING_TARGET_SIMILARITY_MIN: float = 800000.0  # ₹8,00,000 (~$9,600)
    SMURFING_TARGET_SIMILARITY_MAX: float = 829500.0  # ₹8,29,500 (~$9,990)

    # --- Frontend origin (CORS) ---
    FRONTEND_ORIGIN: str = "http://localhost:5173"

    # --- SMTP (Email Fraud Alerts) ---
    SMTP_USER: str = ""
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@fingraph.io"

    # --- Case Management ---
    CASE_PREFIX: str = "CASE-"
    DEFAULT_CASE_SLA_HOURS: int = 72

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

