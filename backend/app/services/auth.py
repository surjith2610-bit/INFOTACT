import os
import time
import logging
import hashlib
from typing import Optional, Dict, Any
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("auth_service")

# Secret key & token config
SECRET_KEY = os.getenv("JWT_SECRET", "fingraph-super-secret-key-2026-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

try:
    import jwt
    JWT_AVAILABLE = True
except ImportError:
    JWT_AVAILABLE = False
    logger.warning("[AUTH] PyJWT not available. Using fallback token generator.")

try:
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    PASSLIB_AVAILABLE = True
except Exception:
    PASSLIB_AVAILABLE = False
    logger.warning("[AUTH] Passlib bcrypt not available. Using SHA256 fallback for hashing.")


def hash_password(password: str) -> str:
    """Hashes password using bcrypt or SHA256 fallback."""
    if PASSLIB_AVAILABLE:
        try:
            return pwd_context.hash(password)
        except Exception:
            pass
    return hashlib.sha256((password + SECRET_KEY).encode("utf-8")).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies password against stored hash."""
    if PASSLIB_AVAILABLE and (hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$")):
        try:
            return pwd_context.verify(plain_password, hashed_password)
        except Exception:
            pass
    return hash_password(plain_password) == hashed_password


# Demo User Database in memory
USERS_DB: Dict[str, Dict[str, Any]] = {
    "admin@fingraph.io": {
        "id": "USR-ADMIN-01",
        "email": "admin@fingraph.io",
        "name": "Security Administrator",
        "role": "ADMIN",
        "password_hash": hash_password("admin123"),
    },
    "analyst@fingraph.io": {
        "id": "USR-ANALYST-01",
        "email": "analyst@fingraph.io",
        "name": "Fraud Analyst",
        "role": "ANALYST",
        "password_hash": hash_password("analyst123"),
    },
}


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Creates signed JWT token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": int(expire.timestamp())})

    if JWT_AVAILABLE:
        return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    else:
        # Fallback simple token format if pyjwt not installed
        raw_payload = f"{to_encode['sub']}:{to_encode.get('role', 'ANALYST')}:{to_encode['exp']}"
        sig = hashlib.sha256((raw_payload + SECRET_KEY).encode("utf-8")).hexdigest()[:16]
        return f"FG-TOKEN.{raw_payload}.{sig}"


def decode_access_token(token: str) -> Optional[dict]:
    """Decodes and verifies JWT token."""
    if JWT_AVAILABLE:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            return payload
        except Exception as e:
            logger.warning(f"[AUTH] Token decode failed: {e}")
            return None
    else:
        try:
            parts = token.split(".")
            if len(parts) != 3 or parts[0] != "FG-TOKEN":
                return None
            raw_payload, sig = parts[1], parts[2]
            sub, role, exp_str = raw_payload.split(":")
            if int(exp_str) < time.time():
                return None
            return {"sub": sub, "role": role, "exp": int(exp_str)}
        except Exception:
            return None


def authenticate_user(email: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticates email + password against user store."""
    user = USERS_DB.get(email.lower().strip())
    if not user:
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return user


def register_user(email: str, password: str, name: str, role: str = "ANALYST") -> Dict[str, Any]:
    """Registers a new user into the user store."""
    email_clean = email.lower().strip()
    if email_clean in USERS_DB:
        raise ValueError("User with this email already exists.")
    
    user_id = f"USR-{os.urandom(4).hex().upper()}"
    new_user = {
        "id": user_id,
        "email": email_clean,
        "name": name,
        "role": role if role in ["ADMIN", "ANALYST"] else "ANALYST",
        "password_hash": hash_password(password),
    }
    USERS_DB[email_clean] = new_user
    return new_user
