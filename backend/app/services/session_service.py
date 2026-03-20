import re
import uuid

from ..models import SafeUser, AuthTokens, SessionRecord, DeviceInfo
from ..repositories.session_repo import (
    create_session,
    find_active_sessions_by_user_id,
    invalidate_other_sessions,
    invalidate_session_by_token,
    invalidate_all_user_sessions,
    update_session_last_active,
    update_session_token,
)
from .auth_token import issue_tokens, get_refresh_token_expiry


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
    if user.role != "admin":
        invalidated_count = invalidate_other_sessions(user.id, session.id)
        kicked = invalidated_count > 0

    return {
        "tokens": tokens,
        "session": session,
        "kicked_other_devices": kicked,
    }


def logout(refresh_token: str) -> bool:
    return invalidate_session_by_token(refresh_token)


def logout_all_devices(user_id: int) -> int:
    return invalidate_all_user_sessions(user_id)


def get_user_sessions(user_id: int) -> list[SessionRecord]:
    return find_active_sessions_by_user_id(user_id)
