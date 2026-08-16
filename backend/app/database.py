import time
import logging
from neo4j import GraphDatabase
from app.config import settings

logger = logging.getLogger("database")

# --- Mongo (optional store for auth users / OTP codes) ---
try:
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_client = AsyncIOMotorClient(settings.MONGO_URI, serverSelectionTimeoutMS=2000)
    mongo_db = mongo_client[settings.MONGO_DB]
    users_collection = mongo_db["users"]
    otp_collection = mongo_db["otp_codes"]
except Exception as mongo_err:
    logger.info(f"[MONGO] Optional Mongo client init warning: {mongo_err}")
    users_collection = None
    otp_collection = None


class Neo4jConnection:
    def __init__(self, uri: str, user: str, password: str, database: str = "neo4j"):
        self.uri = uri
        self.user = user
        self.password = password
        self.database = database
        self._driver = None

    def get_driver(self):
        if self._driver is None:
            max_retries = 3
            for attempt in range(1, max_retries + 1):
                try:
                    self._driver = GraphDatabase.driver(
                        self.uri, auth=(self.user, self.password)
                    )
                    self._driver.verify_connectivity()
                    logger.info(f"[NEO4J] Connected successfully to {self.uri}")
                    break
                except Exception as e:
                    logger.warning(
                        f"[NEO4J] Connection attempt {attempt}/{max_retries} failed: {e}. Graph queries will retry when Neo4j is ready."
                    )
                    if attempt == max_retries:
                        logger.warning("[NEO4J] Neo4j is offline. Backend starting in API fallback mode.")
                        self._driver = None
                        break
                    time.sleep(1)
        return self._driver

    def close(self):
        if self._driver:
            self._driver.close()
            self._driver = None

    def run(self, query: str, parameters: dict | None = None):
        driver = self.get_driver()
        if driver is None:
            logger.warning(f"[NEO4J] Skipping Cypher query as Neo4j is offline: {query[:40]}...")
            return []
        with driver.session(database=self.database) as session:
            result = session.run(query, parameters or {})
            return [record.data() for record in result]


neo4j_conn = Neo4jConnection(
    settings.NEO4J_URI,
    settings.NEO4J_USER,
    settings.NEO4J_PASSWORD,
    settings.NEO4J_DATABASE,
)


def init_neo4j_constraints():
    """Run once at startup to keep Account, Person, Bank, and FraudAlert IDs unique."""
    constraints = [
        "CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.accountId IS UNIQUE",
        "CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.personId IS UNIQUE",
        "CREATE CONSTRAINT bank_id IF NOT EXISTS FOR (b:Bank) REQUIRE b.bankId IS UNIQUE",
        "CREATE CONSTRAINT alert_id IF NOT EXISTS FOR (f:FraudAlert) REQUIRE f.id IS UNIQUE",
    ]
    for constraint in constraints:
        try:
            neo4j_conn.run(constraint)
        except Exception as e:
            logger.warning(f"[NEO4J] Constraint creation warning: {e}")
