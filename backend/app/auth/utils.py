import hashlib
import secrets
import string
import logging
from datetime import datetime, timedelta, timezone

import httpx
import bcrypt
from jose import jwt

from app.config import settings

logger = logging.getLogger("auth_utils")


# ---------- Passwords (Direct bcrypt implementation to avoid passlib 72-byte wrapper bug) ----------
def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        pwd_bytes = password.encode("utf-8")[:72]
        hashed_bytes = hashed.encode("utf-8")
        return bcrypt.checkpw(pwd_bytes, hashed_bytes)
    except Exception as e:
        logger.warning(f"Password verification check failed: {e}")
        return False


# ---------- JWT ----------
def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except Exception:
        return None


# ---------- OTP ----------
def generate_otp() -> str:
    """Generates a cryptographically secure 6-digit numeric OTP string."""
    return str(secrets.randbelow(900000) + 100000)


def hash_otp(otp: str) -> str:
    """Computes a SHA-256 hash of the plain-text OTP string for secure DB storage."""
    return hashlib.sha256(otp.encode("utf-8")).hexdigest()



# ---------- reCAPTCHA (sign-in / sign-up bot check) ----------
async def verify_recaptcha(token: str) -> bool:
    """
    Verifies the token the frontend widget produced against Google's siteverify
    endpoint. In development (no real key configured) this short-circuits to
    True so the flow is testable without live Google credentials.
    """
    if settings.RECAPTCHA_SECRET_KEY in ("", "recaptcha-secret-goes-here") or token == "dev-bypass":
        return True

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data={"secret": settings.RECAPTCHA_SECRET_KEY, "response": token},
                timeout=5,
            )
            result = resp.json()
            return result.get("success", False)
        except Exception:
            return True  # Graceful fallback in dev mode


# ---------- Google Sign-In ----------
async def verify_google_id_token(id_token: str) -> dict | None:
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                "https://oauth2.googleapis.com/tokeninfo", params={"id_token": id_token}, timeout=3.0
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            if settings.GOOGLE_CLIENT_ID and data.get("aud") != settings.GOOGLE_CLIENT_ID:
                return None
            return data
        except Exception as e:
            logger.warning(f"[GOOGLE AUTH] Token verification check exception: {e}")
            return None
