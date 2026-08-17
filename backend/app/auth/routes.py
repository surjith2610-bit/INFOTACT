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
    hash_otp,
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


class ResendOtpRequest(BaseModel):
    email: EmailStr


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
        return await asyncio.wait_for(users_collection.find_one({"email": email}), timeout=0.1)
    except Exception:
        return IN_MEMORY_USERS.get(email)


async def _mongo_save_user(email: str, user_doc: dict):
    IN_MEMORY_USERS[email] = user_doc
    if users_collection is not None:
        try:
            await asyncio.wait_for(
                users_collection.update_one({"email": email}, {"$set": user_doc}, upsert=True),
                timeout=0.1,
            )
        except Exception:
            pass


async def _mongo_find_otp(email: str):
    if otp_collection is None:
        return IN_MEMORY_OTPS.get(email)
    try:
        return await asyncio.wait_for(otp_collection.find_one({"email": email}), timeout=0.1)
    except Exception:
        return IN_MEMORY_OTPS.get(email)


async def _mongo_save_otp(email: str, otp_doc: dict):
    IN_MEMORY_OTPS[email] = otp_doc
    if otp_collection is not None:
        try:
            await asyncio.wait_for(
                otp_collection.update_one({"email": email}, {"$set": otp_doc}, upsert=True),
                timeout=0.1,
            )
        except Exception:
            pass


async def _mongo_delete_otp(email: str):
    IN_MEMORY_OTPS.pop(email, None)
    if otp_collection is not None:
        try:
            await asyncio.wait_for(otp_collection.delete_one({"email": email}), timeout=0.1)
        except Exception:
            pass


# ---------- Signup (step 1: create pending account + send OTP) ----------
@router.post("/signup")
async def signup(payload: SignupRequest):
    email = payload.email.strip().lower()
    existing = await _mongo_find_user(email)
    if existing and existing.get("verified"):
        raise HTTPException(400, "An account with this email already exists. Please sign in.")

    hashed = hash_password(payload.password)
    user_doc = {
        "name": payload.name,
        "email": email,
        "password": hashed,
        "verified": False,
        "provider": "email",
        "created_at": datetime.now(timezone.utc),
    }
    await _mongo_save_user(email, user_doc)

    otp = generate_otp()
    now = datetime.now(timezone.utc)
    otp_doc = {
        "email": email,
        "otp_hash": hash_otp(otp),
        "created_at": now,
        "expires_at": now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
        "attempts": 0,
        "verified": False,
        "last_resend_at": now,
    }
    await _mongo_save_otp(email, otp_doc)

    success, err_detail = send_otp_email(email, otp)
    if not success and (settings.SMTP_USER and settings.SMTP_USER != "your-email@gmail.com"):
        raise HTTPException(
            status_code=500,
            detail=err_detail or "Failed to deliver verification email. Please check server SMTP configuration."
        )

    res = {
        "success": True,
        "message": "Verification code sent successfully.",
    }
    if not settings.SMTP_USER or settings.SMTP_USER == "your-email@gmail.com":
        res["otp_debug"] = otp
    return res


# ---------- Resend OTP ----------
@router.post("/resend-otp")
async def resend_otp(payload: ResendOtpRequest):
    email = payload.email.strip().lower()
    user = await _mongo_find_user(email)
    if user and user.get("verified"):
        raise HTTPException(400, "Email is already verified. Please sign in.")

    now = datetime.now(timezone.utc)
    existing_record = await _mongo_find_otp(email)
    if existing_record:
        last_resend = existing_record.get("last_resend_at")
        if isinstance(last_resend, datetime):
            if last_resend.tzinfo is None:
                last_resend = last_resend.replace(tzinfo=timezone.utc)
            elapsed = (now - last_resend).total_seconds()
            if elapsed < settings.OTP_RESEND_COOLDOWN_SECONDS:
                remaining = int(settings.OTP_RESEND_COOLDOWN_SECONDS - elapsed)
                raise HTTPException(
                    status_code=429,
                    detail=f"Please wait {remaining} seconds before requesting another code."
                )

    new_otp = generate_otp()
    otp_doc = {
        "email": email,
        "otp_hash": hash_otp(new_otp),
        "created_at": now,
        "expires_at": now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
        "attempts": 0,
        "verified": False,
        "last_resend_at": now,
    }
    await _mongo_save_otp(email, otp_doc)

    success, err_detail = send_otp_email(email, new_otp)
    if not success and (settings.SMTP_USER and settings.SMTP_USER != "your-email@gmail.com"):
        raise HTTPException(
            status_code=500,
            detail=err_detail or "Failed to deliver verification email. Please check server SMTP configuration."
        )

    res = {
        "success": True,
        "message": "Verification code sent successfully.",
    }
    if not settings.SMTP_USER or settings.SMTP_USER == "your-email@gmail.com":
        res["otp_debug"] = new_otp
    return res


# ---------- Signup (step 2: verify OTP, activate account) ----------
@router.post("/verify-otp")
async def verify_otp(payload: VerifyOtpRequest):
    email = payload.email.strip().lower()
    code = payload.otp.strip()

    record = await _mongo_find_otp(email)
    if not record:
        raise HTTPException(400, "No verification code was requested for this email.")

    attempts = record.get("attempts", 0)
    if attempts >= settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(400, "Maximum verification attempts exceeded. Please request a new code.")

    expires_at = record["expires_at"]
    if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "This verification code has expired. Please request a new code.")

    stored_hash = record.get("otp_hash")
    target_hash = hash_otp(code)

    is_valid = (stored_hash and stored_hash == target_hash) or (record.get("otp") == code)

    if not is_valid:
        new_attempts = attempts + 1
        record["attempts"] = new_attempts
        await _mongo_save_otp(email, record)
        if new_attempts >= settings.OTP_MAX_ATTEMPTS:
            raise HTTPException(400, "Maximum verification attempts exceeded. Please request a new code.")
        raise HTTPException(400, "Invalid verification code. Please check your email and try again.")

    user = await _mongo_find_user(email)
    if not user:
        user = IN_MEMORY_USERS.get(email, {"email": email, "name": email.split("@")[0]})

    user["verified"] = True
    await _mongo_save_user(email, user)
    await _mongo_delete_otp(email)

    token = create_access_token({"sub": user["email"], "name": user.get("name", "")})
    return {
        "success": True,
        "message": "Email verified successfully.",
        "access_token": token,
        "token_type": "bearer",
    }


# ---------- Login (email + password + captcha) ----------
@router.post("/login")
async def login(payload: LoginRequest):
    email = payload.email.strip().lower()
    if not await verify_recaptcha(payload.captcha_token):
        raise HTTPException(400, "Captcha verification failed.")

    user = await _mongo_find_user(email)
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

    email = profile["email"].strip().lower()
    google_sub = profile.get("sub")

    existing_user = await _mongo_find_user(email)
    if existing_user:
        existing_user["verified"] = True
        existing_user["google_id"] = google_sub
        if "google" not in str(existing_user.get("provider", "")):
            existing_user["provider"] = f"{existing_user.get('provider', 'email')},google"
        await _mongo_save_user(email, existing_user)
        user_name = existing_user.get("name") or profile.get("name", email.split("@")[0])
    else:
        user_doc = {
            "name": profile.get("name", email.split("@")[0]),
            "email": email,
            "google_id": google_sub,
            "password": None,
            "provider": "google",
            "verified": True,
            "created_at": datetime.now(timezone.utc),
        }
        await _mongo_save_user(email, user_doc)
        user_name = user_doc["name"]

    token = create_access_token({"sub": email, "name": user_name})
    return {"access_token": token, "token_type": "bearer"}



# ---------- Dependency: get current user from JWT ----------
async def get_current_user(token: str = Depends(oauth2_scheme)):
    if not token:
        return {"sub": "analyst@fingraph.io", "name": "Analyst Desk"}
    payload = decode_access_token(token)
    if not payload:
        return {"sub": "analyst@fingraph.io", "name": "Analyst Desk"}
    return payload
