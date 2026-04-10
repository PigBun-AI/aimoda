import re
import uuid

from ..models import SafeUser, SessionRecord, DeviceInfo
from ..repositories.session_repo import (
    create_session,
    find_session_by_refresh_token,
    find_active_sessions_by_user_id,
    invalidate_other_sessions,
    invalidate_session_by_token,
    invalidate_all_user_sessions,
    update_session_last_active,
    update_session_token,
)
from ..repositories.user_repo import find_user_by_id
from .auth_token import issue_tokens, get_refresh_token_expiry, verify_refresh_token


def parse_device_info(user_agent: str) -> DeviceInfo:
    """Parse User-Agent string into device info."""
    info = DeviceInfo()

    # Detect OS
    if re.search(r"iPhone|iPad|iPod", user_agent):
        info.os = "iOS"
        info.device = "tablet" if "iPad" in user_agent else "mobile"
    elif "Android" in user_agent:
        info.os = "Android"
        info.device = "mobile" if "Mobile" in user_agent else "tablet"
    elif "Windows" in user_agent:
        info.os = "Windows"
        info.device = "desktop"
    elif "Mac" in user_agent:
        info.os = "macOS"
        info.device = "desktop"
    elif "Linux" in user_agent:
        info.os = "Linux"
        info.device = "desktop"

    # Detect browser
    if "Edg" in user_agent:
        info.browser = "Edge"
    elif "Chrome" in user_agent:
        info.browser = "Chrome"
    elif "Safari" in user_agent:
        info.browser = "Safari"
    elif "Firefox" in user_agent:
        info.browser = "Firefox"

    parts = [p for p in [info.browser, info.os, info.device] if p]
    info.deviceName = " - ".join(parts) or "Unknown Device"

    return info


def login_with_session(
    user: SafeUser,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> dict:
    """Create session and return tokens. Implements SSO for non-admin users."""
    device_info = parse_device_info(user_agent) if user_agent else None

    expires_at = get_refresh_token_expiry()
    temp_token = f"temp-{uuid.uuid4()}"

    session = create_session(
        user_id=user.id,
        refresh_token=temp_token,
        device_info=device_info,
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=expires_at,
    )

    tokens = issue_tokens(user, session.id)

    # Update session with actual refresh token
    update_session_token(session.id, tokens.refreshToken)

    # SSO: non-admin users invalidate other sessions
    kicked = False
    revoked_session_ids: list[int] = []
    if user.role != "admin":
        revoked_session_ids = invalidate_other_sessions(user.id, session.id)
        kicked = len(revoked_session_ids) > 0

    return {
        "tokens": tokens,
        "session": session,
        "kicked_other_devices": kicked,
        "revoked_session_ids": revoked_session_ids,
    }


def logout(refresh_token: str) -> bool:
    return invalidate_session_by_token(refresh_token)


def logout_all_devices(user_id: int) -> int:
    return invalidate_all_user_sessions(user_id)


def get_user_sessions(user_id: int) -> list[SessionRecord]:
    return find_active_sessions_by_user_id(user_id)


def refresh_session(refresh_token: str) -> dict | None:
    session = find_session_by_refresh_token(refresh_token)
    if not session:
        return None

    try:
        token_user = verify_refresh_token(refresh_token)
    except ValueError:
        return None

    if token_user.id != session.user_id:
        return None

    user = find_user_by_id(session.user_id)
    if not user:
        return None

    safe_user = SafeUser(
        id=user.id,
        email=user.email,
        phone=user.phone,
        role=user.role,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
    tokens = issue_tokens(safe_user, session.id)
    update_session_token(session.id, tokens.refreshToken)
    update_session_last_active(session.id)

    return {
        "user": safe_user,
        "tokens": tokens,
        "session": session,
    }
