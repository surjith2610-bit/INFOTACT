import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_get_transaction_trace():
    response = client.get("/api/transactions/trace/ACC0001")
    assert response.status_code == 200
    data = response.json()
    assert "account" in data
    assert data["account"]["id"] == "ACC0001"
    assert "incoming_transactions" in data
    assert "outgoing_transactions" in data
    assert "total_incoming" in data
    assert "total_outgoing" in data

def test_root_alias_transaction_trace():
    response = client.get("/transactions/trace/ACC0001")
    assert response.status_code == 200
    data = response.json()
    assert data["account"]["id"] == "ACC0001"

def test_search_transaction_trace():
    response = client.get("/api/transactions/trace?account_id=ACC0001")
    assert response.status_code == 200
    data = response.json()
    assert "transactions" in data
    assert "total_incoming" in data
    assert "total_outgoing" in data
    assert "suspicious_count" in data
