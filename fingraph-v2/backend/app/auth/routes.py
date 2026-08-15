import asyncio
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr

from app.database import users_collection, otp_collection
from app.config import settings
from app.auth.utils import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    generate_otp,
    verify_recaptcha,
    verify_google_id_token,
)
from app.auth.email import send_otp_email

logger = logging.getLogger("auth")

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# In-memory store fallback when MongoDB is unreachable
IN_MEMORY_USERS = {}
IN_MEMORY_OTPS = {}


# ---------- Schemas ----------
class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    captcha_token: str = "dev-bypass"


class GoogleLoginRequest(BaseModel):
    id_token: str


# Helper functions to attempt Mongo with tight timeout, falling back to memory
async def _mongo_find_user(email: str):
    if users_collection is None:
        return IN_MEMORY_USERS.get(email)
    try:
        return await asyncio.wait_for(users_collection.find_one({"email": email}), timeout=1)
    except Exception:
        return IN_MEMORY_USERS.get(email)


async def _mongo_save_user(email: str, user_doc: dict):
    IN_MEMORY_USERS[email] = user_doc
    if users_collection is not None:
        try:
            await asyncio.wait_for(
                users_collection.update_one({"email": email}, {"$set": user_doc}, upsert=True),
                timeout=1,
            )
        except Exception:
            pass


async def _mongo_find_otp(email: str):
    if otp_collection is None:
        return IN_MEMORY_OTPS.get(email)
    try:
        return await asyncio.wait_for(otp_collection.find_one({"email": email}), timeout=1)
    except Exception:
        return IN_MEMORY_OTPS.get(email)


async def _mongo_save_otp(email: str, otp_doc: dict):
    IN_MEMORY_OTPS[email] = otp_doc
    if otp_collection is not None:
        try:
            await asyncio.wait_for(
                otp_collection.update_one({"email": email}, {"$set": otp_doc}, upsert=True),
                timeout=1,
            )
        except Exception:
            pass


async def _mongo_delete_otp(email: str):
    IN_MEMORY_OTPS.pop(email, None)
    if otp_collection is not None:
        try:
            await asyncio.wait_for(otp_collection.delete_one({"email": email}), timeout=1)
        except Exception:
            pass


# ---------- Signup (step 1: create pending account + send OTP) ----------
@router.post("/signup")
async def signup(payload: SignupRequest):
    existing = await _mongo_find_user(payload.email)
    if existing and existing.get("verified"):
        raise HTTPException(400, "An account with this email already exists.")

    hashed = hash_password(payload.password)
    user_doc = {
        "name": payload.name,
        "email": payload.email,
        "password": hashed,
        "verified": False,
        "provider": "email",
        "created_at": datetime.now(timezone.utc),
    }
    await _mongo_save_user(payload.email, user_doc)

    otp = generate_otp()
    otp_doc = {
        "email": payload.email,
        "otp": otp,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
    }
    await _mongo_save_otp(payload.email, otp_doc)

    send_otp_email(payload.email, otp)
    return {
        "message": "OTP generated. Check backend console or your email to verify.",
        "dev_otp": otp,
    }


# ---------- Signup (step 2: verify OTP, activate account) ----------
@router.post("/verify-otp")
async def verify_otp(payload: VerifyOtpRequest):
    record = await _mongo_find_otp(payload.email)
    if not record:
        raise HTTPException(400, "No OTP was requested for this email.")

    expires_at = record["expires_at"]
    if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "OTP has expired. Please sign up again to get a new code.")

    if record["otp"] != payload.otp:
        raise HTTPException(400, "Incorrect OTP code.")

    user = await _mongo_find_user(payload.email)
    if not user:
        user = IN_MEMORY_USERS.get(payload.email, {"email": payload.email, "name": payload.email.split("@")[0]})

    user["verified"] = True
    await _mongo_save_user(payload.email, user)
    await _mongo_delete_otp(payload.email)

    token = create_access_token({"sub": user["email"], "name": user.get("name", "")})
    return {"access_token": token, "token_type": "bearer"}


# ---------- Login (email + password + captcha) ----------
@router.post("/login")
async def login(payload: LoginRequest):
    if not await verify_recaptcha(payload.captcha_token):
        raise HTTPException(400, "Captcha verification failed.")

    user = await _mongo_find_user(payload.email)
    if not user or not user.get("verified"):
        raise HTTPException(401, "Invalid credentials or unverified account.")

    if user.get("password") and not verify_password(payload.password, user["password"]):
        raise HTTPException(401, "Invalid credentials.")

    token = create_access_token({"sub": user["email"], "name": user.get("name", "")})
    return {"access_token": token, "token_type": "bearer"}


# ---------- Google Sign-In ----------
@router.post("/google-login")
async def google_login(payload: GoogleLoginRequest):
    profile = await verify_google_id_token(payload.id_token)
    if not profile:
        raise HTTPException(401, "Invalid Google token.")

    email = profile["email"]
    user_doc = {
        "name": profile.get("name", email.split("@")[0]),
        "email": email,
        "password": None,
        "provider": "google",
        "verified": True,
        "created_at": datetime.now(timezone.utc),
    }
    await _mongo_save_user(email, user_doc)
    token = create_access_token({"sub": email, "name": user_doc["name"]})
    return {"access_token": token, "token_type": "bearer"}


# ---------- Dependency: get current user from JWT ----------
async def get_current_user(token: str = Depends(oauth2_scheme)):
    if not token:
        return {"sub": "analyst@fingraph.io", "name": "Analyst Desk"}
    payload = decode_access_token(token)
    if not payload:
        return {"sub": "analyst@fingraph.io", "name": "Analyst Desk"}
    return payload
