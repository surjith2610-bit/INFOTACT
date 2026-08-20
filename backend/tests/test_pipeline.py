"""
Unit & Integration Test Suite for FinGraph Fraud Analytics Pipeline
"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.services.detection import (
    detect_smurfing,
    detect_circular_transfers,
    detect_high_frequency,
    detect_large_transaction,
    create_fraud_alert,
)

client = TestClient(app)


def test_health_endpoint():
    """Verify GET /health returns 200 OK with expected payload."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "service" in data


@patch("app.routes.api.neo4j_conn.run")
def test_stats_endpoint(mock_neo4j):
    """Verify GET /api/stats aggregates system metrics correctly."""
    mock_neo4j.side_effect = [
        [{"accountCount": 10, "txCount": 25, "alertCount": 3, "highSeverityCount": 1}],
        [{"type": "SMURFING_STRUCTURING", "count": 2}, {"type": "LARGE_TRANSACTION_EXCEEDED", "count": 1}],
    ]
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["total_accounts"] == 10
    assert data["total_transactions"] == 25
    assert data["fraud_alerts"] == 3


@patch("app.services.detection.neo4j_conn.run")
def test_detect_smurfing_rule(mock_neo4j):
    """Verify smurfing detection logic processes query results into alerts."""
    mock_neo4j.return_value = [
        {
            "receiverId": "SHELL01",
            "senders": ["SMURF01", "SMURF02", "SMURF03", "SMURF04", "SMURF05"],
            "txIds": ["tx1", "tx2", "tx3", "tx4", "tx5"],
            "senderCount": 5,
            "totalAmount": 48500.0,
            "avgAmount": 9700.0,
            "distinctIps": 1,
        }
    ]
    alerts = detect_smurfing(limit=5)
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["type"] == "SMURFING_STRUCTURING"
    assert alert["severity"] == "HIGH"
    assert "SHELL01" in alert["account_ids"]


@patch("app.services.detection.neo4j_conn.run")
def test_detect_circular_transfers_rule(mock_neo4j):
    """Verify circular transfer detection logic identifies cycle topologies."""
    mock_neo4j.return_value = [
        {
            "rawAccs": ["A", "B", "C", "A"],
            "txIds": ["tx1", "tx2", "tx3"],
            "amounts": [1000.0, 1000.0, 1000.0],
        }
    ]
    alerts = detect_circular_transfers(max_depth=3)
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["type"] == "CIRCULAR_TRANSFER"
    assert alert["severity"] == "CRITICAL"
    assert set(alert["account_ids"]) == {"A", "B", "C"}


@patch("app.services.detection.neo4j_conn.run")
def test_detect_high_frequency_rule(mock_neo4j):
    """Verify high frequency transaction rule flags velocity anomaly."""
    mock_neo4j.return_value = [
        {
            "accountId": "ACC999",
            "txCount": 15,
            "peerAccounts": ["ACC001", "ACC002"],
            "txIds": ["t1", "t2"],
        }
    ]
    alerts = detect_high_frequency(count_threshold=10)
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["type"] == "HIGH_FREQUENCY_VELOCITY"
    assert "ACC999" in alert["account_ids"]


@patch("app.services.detection.neo4j_conn.run")
def test_detect_large_transaction_rule(mock_neo4j):
    """Verify large transaction threshold rule flags transfers > threshold."""
    mock_neo4j.return_value = [
        {
            "txId": "tx-large-01",
            "sender": "BIG_SENDER",
            "receiver": "BIG_RECEIVER",
            "amount": 50000.0,
            "timestamp": "2026-08-15T12:00:00Z",
        }
    ]
    alerts = detect_large_transaction(threshold=10000.0)
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["type"] == "LARGE_TRANSACTION_EXCEEDED"
    assert alert["severity"] == "CRITICAL"
    assert alert["account_ids"] == ["BIG_SENDER", "BIG_RECEIVER"]

