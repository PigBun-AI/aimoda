import re
import uuid
from datetime import datetime, timedelta, timezone

import jwt

from ..config import settings
from ..models import SafeUser, AuthTokens, AuthenticatedUser


def _parse_expires_in(expires_in: str) -> int:
    """Parse expiration string like '2h', '7d' into seconds."""
    match = re.match(r"^(\d+)([hdmy])$", expires_in)
    if not match:
        return 7 * 24 * 3600  # default 7 days
    value = int(match.group(1))
    unit = match.group(2)
    multipliers = {"h": 3600, "d": 86400, "m": 30 * 86400, "y": 365 * 86400}
    return value * multipliers.get(unit, 86400)


def _create_token(user: SafeUser, token_type: str, session_id: int | None = None) -> str:
    expires_in = (
        settings.ACCESS_TOKEN_EXPIRES_IN
        if token_type == "access"
        else settings.REFRESH_TOKEN_EXPIRES_IN
    )
    seconds = _parse_expires_in(expires_in)
    now = datetime.now(timezone.utc)

    payload: dict = {
        "sub": str(user.id),
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "type": token_type,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + timedelta(seconds=seconds),
    }

    if token_type == "access" and session_id is not None:
        payload["sessionId"] = session_id

    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def issue_tokens(user: SafeUser, session_id: int | None = None) -> AuthTokens:
    return AuthTokens(
        accessToken=_create_token(user, "access", session_id),
        refreshToken=_create_token(user, "refresh"),
    )


def issue_report_preview_token(user: AuthenticatedUser) -> str:
    now = datetime.now(timezone.utc)
    payload: dict = {
        "sub": str(user.id),
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "type": "report_preview",
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + timedelta(seconds=settings.REPORT_PREVIEW_TOKEN_TTL_SECONDS),
    }
    if user.session_id is not None:
        payload["sessionId"] = user.session_id

    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def verify_access_token(token: str) -> AuthenticatedUser:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise ValueError(f"Invalid token: {e}") from e

    if payload.get("type") != "access":
        raise ValueError("Invalid token type")

    return AuthenticatedUser(
        id=int(payload["sub"]),
        email=payload["email"],
        phone=payload.get("phone"),
        role=payload["role"],
        session_id=payload.get("sessionId"),
    )


def verify_refresh_token(token: str) -> AuthenticatedUser:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise ValueError(f"Invalid token: {e}") from e

    if payload.get("type") != "refresh":
        raise ValueError("Invalid token type")

    return AuthenticatedUser(
        id=int(payload["sub"]),
        email=payload["email"],
        phone=payload.get("phone"),
        role=payload["role"],
        session_id=None,
    )


def verify_report_preview_token(token: str) -> AuthenticatedUser:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise ValueError(f"Invalid token: {e}") from e

    if payload.get("type") != "report_preview":
        raise ValueError("Invalid token type")

    return AuthenticatedUser(
        id=int(payload["sub"]),
        email=payload["email"],
        phone=payload.get("phone"),
        role=payload["role"],
        session_id=payload.get("sessionId"),
    )


def get_refresh_token_expiry() -> str:
    seconds = _parse_expires_in(settings.REFRESH_TOKEN_EXPIRES_IN)
    expiry = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    return expiry.isoformat()


def get_refresh_token_ttl_seconds() -> int:
    return _parse_expires_in(settings.REFRESH_TOKEN_EXPIRES_IN)
