import io
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_upload_csv_valid_standard_columns():
    """Verify CSV upload with standard sender_account, receiver_account, amount columns."""
    csv_content = (
        "sender_account,receiver_account,amount,timestamp\n"
        "ACC0001,ACC0002,1500.50,2026-08-20T10:00:00Z\n"
        "ACC0002,ACC0003,2400.00,2026-08-20T10:05:00Z\n"
    )
    files = {"file": ("test_transactions.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    response = client.post("/api/data/upload-csv", files=files)
    assert response.status_code == 200
    data = response.json()
    assert "Successfully ingested 2 transaction record(s)" in data["message"]
    assert data["rows"] == 2


def test_upload_csv_normalized_alias_columns():
    """Verify CSV upload with alternate Kaggle/PaySim headers (nameOrig, nameDest, amount)."""
    csv_content = (
        "nameOrig,nameDest,amount,step\n"
        "SMURF001,SHELL_OFFSHORE_01,9800.00,1\n"
        "SMURF002,SHELL_OFFSHORE_01,9750.00,2\n"
    )
    files = {"file": ("paysim_test.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    response = client.post("/api/data/upload-csv", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["rows"] == 2


def test_upload_csv_missing_required_columns():
    """Verify uploading a CSV with invalid columns returns a 400 Bad Request with clear detail."""
    csv_content = "invalid_col1,invalid_col2\nval1,val2\n"
    files = {"file": ("invalid.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    response = client.post("/api/data/upload-csv", files=files)
    assert response.status_code == 400
    data = response.json()
    assert "CSV missing required columns" in data["detail"]
    assert "Expected columns" in data["detail"]


def test_generate_synthetic_flow():
    """Verify synthetic flow generator endpoint produces transaction dataset without crashing."""
    response = client.post("/api/data/generate?normal_accounts=10&normal_transactions=30&inject_smurfing_ring=true")
    assert response.status_code == 200
    data = response.json()
    assert "Generated" in data["message"]
    assert data["rows"] > 30
