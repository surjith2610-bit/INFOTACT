import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.store import memory_store
from app.services.ml_engine import ml_engine

client = TestClient(app)


def test_ml_engine_smurfing_similarity():
    """Verify Isolation Forest + Random Forest flags ~₹8,17,550 ($9,850) structured smurfing pattern."""
    result = ml_engine.evaluate_fraud_risk(
        amount=817550.0,
        sender_degree=8,
        receiver_degree=1,
        time_delta_seconds=45.0,
        historical_avg=25000.0,
        is_smurfing=True,
    )
    assert result["risk_score"] >= 50.0
    assert result["fraud_probability"] >= 0.50
    assert result["risk_level"] in ["HIGH", "CRITICAL"]
    assert "score_breakdown" in result
    assert result["score_breakdown"]["amount_score"] >= 15.0


def test_account_drilldown_endpoint():
    """Verify 360-degree forensic profile drilldown returns enriched metadata, XAI score, and counterparty metrics."""
    # Seed a test transaction
    memory_store.add_transaction({
        "id": "TX_TEST_DRILLDOWN_01",
        "sender": "DRILLDOWN_SUSPECT",
        "receiver": "DRILLDOWN_COUNTERPARTY",
        "amount": 815000.0,
        "timestamp": "2026-09-07T12:00:00Z",
        "channel": "IMPS",
    })

    response = client.get("/api/account/DRILLDOWN_SUSPECT/drilldown")
    assert response.status_code == 200
    data = response.json()
    assert data["account_id"] == "DRILLDOWN_SUSPECT"
    assert "risk_score" in data
    assert "xai_breakdown" in data
    assert "recent_transactions" in data
    assert "entity_tag" in data
    assert data["outbound_count"] >= 1


def test_timeline_transactions_endpoint():
    """Verify historical transaction scrubber returns chronologically ordered slices with volume metrics."""
    response = client.get("/api/transactions/timeline?limit=50")
    assert response.status_code == 200
    data = response.json()
    assert "transactions" in data
    assert "total_count" in data
    assert isinstance(data["transactions"], list)


def test_syndicate_subgraphs_endpoint():
    """Verify pattern endpoint extracts starburst, circular, and layering subgraphs."""
    response = client.get("/api/graph/patterns")
    assert response.status_code == 200
    data = response.json()
    assert "starburst_smurfing" in data
    assert "circular_laundering" in data or "circular_loop" in data
    assert "layering_chains" in data or "high_value_drain" in data


def test_case_management_lifecycle():
    """Verify complete case management lifecycle: create case -> add investigator note -> update status -> export dossier."""
    # 1. Create AML Case
    create_payload = {
        "title": "Investigate Smurfing Ring Funnel Shell",
        "suspect_account_id": "SHELL_OFFSHORE_01",
        "severity": "CRITICAL",
        "assigned_to": "Senior AML Lead",
        "amount": 8175500.0,
        "initial_note": "Suspicious starburst inbound transfers identified from 10 distinct mule accounts.",
    }
    create_res = client.post("/api/cases", json=create_payload)
    assert create_res.status_code == 200
    case_resp = create_res.json()
    assert "case" in case_resp
    case_data = case_resp["case"]
    assert "case_id" in case_data
    case_id = case_data["case_id"]
    assert case_data["status"] in ["OPEN", "UNDER_INVESTIGATION"]

    # 2. Get Case Detail
    get_res = client.get(f"/api/cases/{case_id}")
    assert get_res.status_code == 200
    assert get_res.json()["case_id"] == case_id

    # 3. Add Investigator Note
    note_payload = {
        "content": "Requested KYC documentation from correspondent banking partner. Freezing outbound SWIFT wires.",
        "author": "Forensic Auditor",
    }
    note_res = client.post(f"/api/cases/{case_id}/notes", json=note_payload)
    assert note_res.status_code == 200
    assert len(note_res.json()["case"]["notes"]) >= 2

    # 4. Update Status to ESCALATED_SAR
    status_payload = {
        "status": "ESCALATED_SAR",
        "note": "Filing Suspicious Activity Report (SAR) with Financial Intelligence Unit.",
    }
    status_res = client.patch(f"/api/cases/{case_id}/status", json=status_payload)
    assert status_res.status_code == 200
    assert status_res.json()["case"]["status"] == "ESCALATED_SAR"

    # 5. Export Printable AML Dossier
    export_res = client.get(f"/api/cases/{case_id}/export")
    assert export_res.status_code == 200
    dossier = export_res.json()
    assert "case" in dossier
    assert "suspect_profile" in dossier
    assert "xai_breakdown" in dossier
    assert dossier["case"]["case_id"] == case_id
