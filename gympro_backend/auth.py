from datetime import datetime, timedelta, timezone
from typing import Optional
import os

# Passlib 1.7.4 expects `bcrypt.__about__.__version__`, but bcrypt>=4 removed
# `__about__`, causing a noisy warning. Patch it early before passlib loads.
try:
    import bcrypt as _bcrypt  # type: ignore

    if not hasattr(_bcrypt, "__about__"):
        class _BcryptAbout:
            __version__ = getattr(_bcrypt, "__version__", "unknown")

        _bcrypt.__about__ = _BcryptAbout()  # type: ignore[attr-defined]
except Exception:
    # If bcrypt isn't installed for some reason, let passlib handle it.
    pass

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import Table, select
from db import engine, metadata
import hashlib
import base64

# Secrets & Expiry Config
# Allow overriding via environment variables so ops can tune without code change.
SECRET_KEY = os.getenv("ACCESS_TOKEN_SECRET", "dev-insecure-change")
REFRESH_SECRET_KEY = os.getenv("REFRESH_TOKEN_SECRET", "dev-insecure-refresh-change")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "50"))  # default 50 mins
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))      # default 7 days
def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if "sub" not in to_encode and "username" in to_encode:
        to_encode["sub"] = to_encode["username"]
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta if expires_delta else timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))
    to_encode.update({"exp": expire, "iat": now})
    return jwt.encode(to_encode, REFRESH_SECRET_KEY, algorithm=ALGORITHM)

def verify_refresh_token(token: str):
    try:
        payload = jwt.decode(token, REFRESH_SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        return username
    except JWTError:
        return None

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class User(BaseModel):
    user_id: Optional[str] = None
    username: str
    account_code: Optional[str] = None
    retail_code: Optional[str] = None

class UserInDB(User):
    hashed_password: str

def _prehash_password_sha256_b64(password: str) -> str:
    """Pre-hash a potentially-long password to a fixed length.

    bcrypt only processes up to 72 bytes of the input. Pre-hashing with SHA-256
    produces a fixed 32-byte digest, encoded as ASCII Base64 (44 chars), safely
    under the bcrypt limit.
    """

    if not isinstance(password, str):
        raise TypeError("password must be a str")

    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")


def hash_password(password: str) -> str:
    """Hash a password using SHA-256 pre-hash + bcrypt (Passlib).

    - Supports arbitrarily long passwords (no truncation)
    - Uses UTF-8 encoding
    - Uses bcrypt salt + cost via Passlib
    """

    prehashed = _prehash_password_sha256_b64(password)
    return pwd_context.hash(prehashed)


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against a stored bcrypt hash.

    Verifies using the same SHA-256 pre-hash strategy. For compatibility with
    older hashes created without pre-hashing, falls back to verifying the raw
    password if the primary verification fails.
    """

    try:
        prehashed = _prehash_password_sha256_b64(password)
        if pwd_context.verify(prehashed, hashed):
            return True
    except Exception:
        # Intentionally swallow and try legacy verify below.
        pass

    # Legacy fallback: older deployments may have stored bcrypt(password)
    # directly. This path can still fail for very long passwords due to the
    # bcrypt 72-byte limit, in which case we return False.
    try:
        return pwd_context.verify(password, hashed)
    except Exception:
        return False


# Backwards-compatible alias used throughout the codebase.
def get_password_hash(password: str) -> str:
    return hash_password(password)

def get_user(username: str):
    try:
        # Get user from database
        users = Table('users', metadata, autoload_with=engine)
        query = select(users).where(users.c.username == username)
        with engine.connect() as connection:
            result = connection.execute(query).first()
            if result:
                # Convert result to dictionary manually to avoid _asdict() issues
                user_dict = {
                    'user_id': getattr(result, 'user_id', None) or getattr(result, 'id', None),
                    'username': result.username,
                    'hashed_password': result.hashed_password,
                    'account_code': getattr(result, 'account_code', None),
                    'retail_code': getattr(result, 'retail_code', None)
                }
                return UserInDB(**user_dict)
    except Exception as e:
        # If database is not available, log the error
        print(f"Database error: {e}")
        return None
    
    return None

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if "sub" not in to_encode and "username" in to_encode:
        to_encode["sub"] = to_encode["username"]
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta if expires_delta else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "iat": now})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_access_token(token: str):
    """Verify access token and return payload if valid, None if invalid"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        return payload
    except JWTError:
        return None

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = get_user(username=token_data.username)
    if user is None:
        raise credentials_exception
    return user 