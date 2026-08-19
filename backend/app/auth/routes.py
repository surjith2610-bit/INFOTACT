import asyncio
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr

from fastapi.responses import RedirectResponse

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
    get_google_oauth_url,
    exchange_google_code_for_user_info,
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


class SocialLinksRequest(BaseModel):
    linkedin: str | None = ""
    twitter: str | None = ""
    github: str | None = ""


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


# Helper to format clean User profile response
def _format_user_profile(user_doc: dict) -> dict:
    social_links = user_doc.get("social_links") or user_doc.get("socialLinks") or {}
    if not isinstance(social_links, dict):
        social_links = {}

    return {
        "name": user_doc.get("name", "Analyst User"),
        "email": user_doc.get("email", ""),
        "verified": user_doc.get("verified", False),
        "provider": user_doc.get("provider", "email"),
        "googleId": user_doc.get("google_id") or user_doc.get("googleId"),
        "socialLinks": {
            "linkedin": social_links.get("linkedin", ""),
            "twitter": social_links.get("twitter", ""),
            "github": social_links.get("github", ""),
        },
    }


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
        "google_id": None,
        "social_links": {"linkedin": "", "twitter": "", "github": ""},
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
    if "social_links" not in user:
        user["social_links"] = {"linkedin": "", "twitter": "", "github": ""}
    await _mongo_save_user(email, user)
    await _mongo_delete_otp(email)

    token = create_access_token({"sub": user["email"], "name": user.get("name", "")})
    return {
        "success": True,
        "message": "Email verified successfully.",
        "access_token": token,
        "token_type": "bearer",
        "user": _format_user_profile(user),
    }


# ---------- Login (email + password + captcha) ----------
@router.post("/login")
async def login(payload: LoginRequest):
    email = payload.email.strip().lower()
    if not await verify_recaptcha(payload.captcha_token):
        raise HTTPException(400, "Captcha verification failed.")

    user = await _mongo_find_user(email)
    if not user or not user.get("verified"):
        raise HTTPException(401, "Invalid email or unverified account. Please check credentials or sign up.")

    if user.get("password") and not verify_password(payload.password, user["password"]):
        raise HTTPException(401, "Invalid password. Please check your credentials and try again.")

    token = create_access_token({"sub": user["email"], "name": user.get("name", "")})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _format_user_profile(user),
    }


# ---------- Google Sign-In (ID Token GIS method) ----------
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
        if "social_links" not in existing_user:
            existing_user["social_links"] = {"linkedin": "", "twitter": "", "github": ""}
        await _mongo_save_user(email, existing_user)
        user_doc = existing_user
    else:
        user_doc = {
            "name": profile.get("name", email.split("@")[0]),
            "email": email,
            "google_id": google_sub,
            "password": None,
            "provider": "google",
            "verified": True,
            "social_links": {"linkedin": "", "twitter": "", "github": ""},
            "created_at": datetime.now(timezone.utc),
        }
        await _mongo_save_user(email, user_doc)

    token = create_access_token({"sub": email, "name": user_doc.get("name", "")})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _format_user_profile(user_doc),
    }


# ---------- Google OAuth 2.0 Redirect Flow ----------
@router.get("/google")
async def google_oauth_redirect(redirect_uri: str | None = None):
    url = get_google_oauth_url(redirect_uri)
    return RedirectResponse(url=url)


@router.get("/google/callback")
async def google_oauth_callback(code: str, redirect_uri: str | None = None):
    user_info = await exchange_google_code_for_user_info(code, redirect_uri)
    if not user_info:
        raise HTTPException(401, "Failed to authenticate with Google OAuth code.")

    email = user_info["email"].strip().lower()
    google_sub = user_info.get("sub")

    existing_user = await _mongo_find_user(email)
    if existing_user:
        existing_user["verified"] = True
        existing_user["google_id"] = google_sub
        if "google" not in str(existing_user.get("provider", "")):
            existing_user["provider"] = f"{existing_user.get('provider', 'email')},google"
        if "social_links" not in existing_user:
            existing_user["social_links"] = {"linkedin": "", "twitter": "", "github": ""}
        await _mongo_save_user(email, existing_user)
        user_doc = existing_user
    else:
        user_doc = {
            "name": user_info.get("name", email.split("@")[0]),
            "email": email,
            "google_id": google_sub,
            "password": None,
            "provider": "google",
            "verified": True,
            "social_links": {"linkedin": "", "twitter": "", "github": ""},
            "created_at": datetime.now(timezone.utc),
        }
        await _mongo_save_user(email, user_doc)

    token = create_access_token({"sub": email, "name": user_doc.get("name", "")})
    
    # Redirect frontend to callback page with token
    frontend_target = f"{settings.FRONTEND_ORIGIN}/auth/google/callback?token={token}"
    return RedirectResponse(url=frontend_target)


# ---------- Dependency: get current user from JWT ----------
async def get_current_user(token: str = Depends(oauth2_scheme)):
    if not token:
        return {"sub": "analyst@fingraph.io", "name": "Analyst Desk"}
    payload = decode_access_token(token)
    if not payload:
        return {"sub": "analyst@fingraph.io", "name": "Analyst Desk"}
    return payload


# ---------- Get Current User Profile ----------
@router.get("/me")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    email = current_user.get("sub", "").strip().lower()
    user = await _mongo_find_user(email)
    if not user:
        user = {
            "name": current_user.get("name", email.split("@")[0] if "@" in email else "Analyst"),
            "email": email,
            "verified": True,
            "provider": "email",
            "social_links": {"linkedin": "", "twitter": "", "github": ""},
        }
    return _format_user_profile(user)


# ---------- Update Social Profile Links ----------
@router.post("/social-links")
async def update_social_links(payload: SocialLinksRequest, current_user: dict = Depends(get_current_user)):
    email = current_user.get("sub", "").strip().lower()
    user = await _mongo_find_user(email)
    if not user:
        user = {
            "name": current_user.get("name", email.split("@")[0] if "@" in email else "Analyst"),
            "email": email,
            "verified": True,
            "provider": "email",
            "social_links": {},
        }

    current_links = user.get("social_links") or user.get("socialLinks") or {}
    if not isinstance(current_links, dict):
        current_links = {}

    current_links["linkedin"] = payload.linkedin.strip() if payload.linkedin is not None else current_links.get("linkedin", "")
    current_links["twitter"] = payload.twitter.strip() if payload.twitter is not None else current_links.get("twitter", "")
    current_links["github"] = payload.github.strip() if payload.github is not None else current_links.get("github", "")

    user["social_links"] = current_links
    await _mongo_save_user(email, user)

    return {
        "success": True,
        "message": "Social media accounts updated successfully.",
        "profile": _format_user_profile(user),
    }

