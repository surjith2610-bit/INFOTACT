"""
Unit tests for FinGraph Transaction Trace Engine & 7 Advanced Fraud Detection Rules
"""
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app
from app.services.detection import (
    detect_smurfing,
    detect_high_velocity,
    detect_circular_transfers,
    detect_dormant_spike,
    detect_amount_anomaly,
    detect_fan_out,
    detect_fan_in,
    run_all_detections,
)

client = TestClient(app)


def test_transaction_trace_endpoint_spec():
    """
    Verifies GET /transactions/trace/:accountId returns exact specification keys:
    account, incoming, outgoing, total_incoming, total_outgoing
    """
    response = client.get("/transactions/trace/ACC0001")
    assert response.status_code == 200
    data = response.json()
    assert "account" in data
    assert "id" in data["account"]
    assert "name" in data["account"]
    assert "bank" in data["account"]

    assert "incoming" in data
    assert "outgoing" in data
    assert "total_incoming" in data
    assert "total_outgoing" in data


def test_full_trace_endpoint_spec():
    """
    Verifies GET /transactions/full-trace/:accountId returns exact specification keys:
    transactions: [{ sender: {id, name, bank}, receiver: {id, name, bank}, amount, timestamp, transactionId }]
    """
    response = client.get("/transactions/full-trace/A101")
    assert response.status_code == 200
    data = response.json()
    assert "transactions" in data
    assert len(data["transactions"]) > 0
    tx = data["transactions"][0]
    assert "sender" in tx
    assert "id" in tx["sender"]
    assert "name" in tx["sender"]
    assert "bank" in tx["sender"]
    assert "receiver" in tx
    assert "id" in tx["receiver"]
    assert "name" in tx["receiver"]
    assert "bank" in tx["receiver"]
    assert "amount" in tx
    assert "timestamp" in tx
    assert "transactionId" in tx


def test_all_seven_fraud_detectors_execution():
    """
    Executes run_all_detections and verifies all 7 fraud rule categories are present in breakdown.
    """
    result = run_all_detections()
    assert "alerts" in result
    assert "breakdown" in result

    bd = result["breakdown"]
    assert "smurfing" in bd
    assert "circular" in bd
    assert "high_frequency" in bd
    assert "large_transaction" in bd
    assert "dormant_spike" in bd
    assert "amount_anomaly" in bd
    assert "fan_out" in bd
    assert "fan_in" in bd
