import time
import logging
from neo4j import GraphDatabase
from app.config import settings

logger = logging.getLogger("database")


class Neo4jConnection:
    def __init__(self, uri: str, user: str, password: str, database: str = "neo4j"):
        self.uri = uri
        self.user = user
        self.password = password
        self.database = database
        self._driver = None
        self._last_failed_time = 0

    def get_driver(self):
        if self._driver is not None:
            return self._driver

        # Cooldown check: if failed recently, don't block API requests with 3s retries
        if time.time() - self._last_failed_time < 10.0:
            return None

        try:
            driver = GraphDatabase.driver(
                self.uri, auth=(self.user, self.password), connection_timeout=1.0
            )
            driver.verify_connectivity()
            self._driver = driver
            logger.info(f"[NEO4J] Connected successfully to {self.uri}")
            return self._driver
        except Exception as e:
            self._last_failed_time = time.time()
            logger.warning(f"[NEO4J] Connection check failed: {e}. Operating in API fallback mode.")
            return None

    def close(self):
        if self._driver:
            self._driver.close()
            self._driver = None

    def run(self, query: str, parameters: dict | None = None):
        driver = self.get_driver()
        if driver is None:
            logger.warning(f"[NEO4J] Skipping Cypher query as Neo4j is offline: {query[:40]}...")
            return []
        try:
            with driver.session(database=self.database) as session:
                result = session.run(query, parameters or {})
                return [record.data() for record in result]
        except Exception as e:
            logger.warning(f"[NEO4J] Execution exception on query: {e}")
            return []


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
