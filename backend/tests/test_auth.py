from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_auth_flow():
    email = "test.analyst@fingraph.io"
    password = "TestPassword123!"
    name = "Test Analyst"

    # 1. Signup request
    resp = client.post(
        "/auth/signup",
        json={"name": name, "email": email, "password": password},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    otp_code = data.get("otp_debug")
    assert otp_code is not None

    # 2. Verify OTP
    verify_resp = client.post(
        "/auth/verify-otp",
        json={"email": email, "otp": otp_code},
    )
    assert verify_resp.status_code == 200
    verify_data = verify_resp.json()
    assert verify_data["success"] is True
    token = verify_data.get("access_token")
    assert token is not None

    # 3. Login with credentials
    login_resp = client.post(
        "/auth/login",
        json={"email": email, "password": password, "captcha_token": "dev-bypass"},
    )
    assert login_resp.status_code == 200
    login_data = login_resp.json()
    assert "access_token" in login_data
    token = login_data["access_token"]

    # 4. Get User Profile (/auth/me)
    headers = {"Authorization": f"Bearer {token}"}
    me_resp = client.get("/auth/me", headers=headers)
    assert me_resp.status_code == 200
    profile = me_resp.json()
    assert profile["email"] == email
    assert profile["name"] == name
    assert "socialLinks" in profile

    # 5. Update Social Links (/auth/social-links)
    social_resp = client.post(
        "/auth/social-links",
        json={
          "linkedin": "https://linkedin.com/in/test-analyst",
          "twitter": "https://twitter.com/test_analyst",
          "github": "https://github.com/test-analyst",
        },
        headers=headers,
    )
    assert social_resp.status_code == 200
    social_data = social_resp.json()
    assert social_data["success"] is True
    assert social_data["profile"]["socialLinks"]["linkedin"] == "https://linkedin.com/in/test-analyst"
    assert social_data["profile"]["socialLinks"]["twitter"] == "https://twitter.com/test_analyst"
    assert social_data["profile"]["socialLinks"]["github"] == "https://github.com/test-analyst"


def test_google_login_flow():
    # Google GIS login endpoint test
    resp = client.post(
        "/auth/google-login",
        json={"id_token": "mock-id-token-dev"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    token = data["access_token"]

    # Verify profile contains googleId
    me_resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    profile = me_resp.json()
    assert profile["googleId"] is not None


def test_google_oauth_callback_flow():
    # Google OAuth callback redirect endpoint test
    resp = client.get("/auth/google/callback?code=mock-google-code-dev", follow_redirects=False)
    assert resp.status_code in (302, 307)
    location = resp.headers.get("location", "")
    assert "/auth/google/callback?token=" in location
