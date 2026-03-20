import re

import bcrypt

from ..exceptions import AppError
from ..models import SafeUser, SessionRecord
from ..repositories.user_repo import find_user_by_email, find_user_by_id, create_user
from ..repositories.activity_repo import log_activity
from ..repositories.session_repo import invalidate_session_by_token
from .session_service import login_with_session, get_user_sessions

_PASSWORD_STRENGTH_RE = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$"
)


def _validate_password_strength(password: str) -> None:
    """Validate password meets strength requirements.

    Requires:
      - At least 8 characters
      - At least one uppercase letter
      - At least one lowercase letter
      - At least one digit
    """
    if not _PASSWORD_STRENGTH_RE.match(password):
        raise AppError("密码必须至少8位，包含大小写字母和数字", 400)


def _to_safe_user(user) -> SafeUser:
    return SafeUser(
        id=user.id,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def login(email: str, password: str, user_agent: str | None = None, ip_address: str | None = None) -> dict:
    user = find_user_by_email(email)
    if not user:
        raise AppError("邮箱或密码错误", 401)

    if not bcrypt.checkpw(password.encode(), user.password_hash.encode()):
        raise AppError("邮箱或密码错误", 401)

    safe_user = _to_safe_user(user)

    result = login_with_session(safe_user, user_agent=user_agent, ip_address=ip_address)

    log_activity(user.id, "login")

    return {
        "user": safe_user,
        "tokens": result["tokens"],
        "kicked_other_devices": user.role != "admin" and result["kicked_other_devices"],
    }


def register(email: str, password: str, user_agent: str | None = None, ip_address: str | None = None) -> dict:
    if find_user_by_email(email):
        raise AppError("邮箱已被注册", 409)

    _validate_password_strength(password)

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user = create_user(email=email, password_hash=password_hash, role="viewer")
    safe_user = _to_safe_user(user)

    result = login_with_session(safe_user, user_agent=user_agent, ip_address=ip_address)

    return {
        "user": safe_user,
        "tokens": result["tokens"],
        "kicked_other_devices": False,
    }


def logout(refresh_token: str) -> bool:
    return invalidate_session_by_token(refresh_token)


def logout_all(user_id: int) -> int:
    from .session_service import logout_all_devices
    return logout_all_devices(user_id)


def get_sessions(user_id: int) -> list[SessionRecord]:
    return get_user_sessions(user_id)


def terminate_session(user_id: int, session_id: int) -> bool:
    sessions = get_user_sessions(user_id)
    target = next((s for s in sessions if s.id == session_id), None)
    if not target:
        return False
    return invalidate_session_by_token(target.refresh_token_hash)


def get_current_user(user_id: int) -> SafeUser | None:
    user = find_user_by_id(user_id)
    return _to_safe_user(user) if user else None
