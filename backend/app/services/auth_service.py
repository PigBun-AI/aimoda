import re
import secrets
import math
from datetime import datetime, timedelta, timezone

import bcrypt

from ..exceptions import AppError
from ..models import SafeUser, SessionRecord, SmsPurpose
from ..repositories.sms_verification_repo import (
    count_sms_codes_sent_since,
    create_sms_code,
    get_latest_active_sms_code,
    hash_code,
    mark_sms_code_consumed,
)
from ..repositories.user_repo import find_user_by_email, find_user_by_id, find_user_by_phone, create_user
from ..repositories.activity_repo import log_activity
from ..repositories.session_repo import invalidate_session_by_id, invalidate_session_by_token
from .session_service import login_with_session, get_user_sessions, refresh_session as refresh_session_with_token
from .sms_gateway_service import SmsGatewayError, send_verification_sms
from ..config import settings

_PASSWORD_STRENGTH_RE = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$"
)
_PHONE_RE = re.compile(r"^(?:\+?86)?1\d{10}$")


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
        phone=user.phone,
        role=user.role,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def _normalize_phone(phone: str) -> str:
    cleaned = re.sub(r"\s+", "", phone or "")
    cleaned = cleaned.replace("-", "")
    if cleaned.startswith("+86"):
        cleaned = cleaned[3:]
    elif cleaned.startswith("86") and len(cleaned) > 11:
        cleaned = cleaned[2:]
    if not _PHONE_RE.match(cleaned):
        raise AppError("手机号格式不正确", 400)
    return cleaned


def _generate_sms_code() -> str:
    if settings.SMS_PROVIDER == "mock" and settings.SMS_MOCK_CODE:
        return settings.SMS_MOCK_CODE
    return f"{secrets.randbelow(10**6):06d}"


def _parse_utc_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace(" ", "T"))

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _create_phone_user(phone: str):
    return create_user(
        email=None,
        phone=phone,
        phone_verified_at=datetime.now(timezone.utc).isoformat(),
        password_hash=None,
        role="viewer",
    )


def _verify_sms_code(phone: str, code: str, purpose: SmsPurpose) -> str:
    normalized_phone = _normalize_phone(phone)
    latest = get_latest_active_sms_code(normalized_phone, purpose)
    if not latest:
        raise AppError("验证码不存在或已失效", 400)

    expires_at = _parse_utc_datetime(str(latest["expires_at"]))
    if expires_at < datetime.now(timezone.utc):
        raise AppError("验证码已过期", 400)

    if hash_code(code) != latest["code_hash"]:
        raise AppError("验证码错误", 400)

    mark_sms_code_consumed(int(latest["id"]))
    return normalized_phone


def login(email: str, password: str, user_agent: str | None = None, ip_address: str | None = None) -> dict:
    user = find_user_by_email(email)
    if not user:
        raise AppError("邮箱或密码错误", 401)

    if not user.password_hash or not bcrypt.checkpw(password.encode(), user.password_hash.encode()):
        raise AppError("邮箱或密码错误", 401)

    safe_user = _to_safe_user(user)

    result = login_with_session(safe_user, user_agent=user_agent, ip_address=ip_address)

    log_activity(user.id, "login")

    return {
        "user": safe_user,
        "tokens": result["tokens"],
        "kicked_other_devices": user.role != "admin" and result["kicked_other_devices"],
        "revoked_session_ids": result.get("revoked_session_ids", []),
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
        "revoked_session_ids": result.get("revoked_session_ids", []),
    }


def logout(refresh_token: str) -> bool:
    return invalidate_session_by_token(refresh_token)


def logout_all(user_id: int) -> int:
    from .session_service import logout_all_devices
    return logout_all_devices(user_id)


def refresh_session(refresh_token: str) -> dict:
    result = refresh_session_with_token(refresh_token)
    if not result:
        raise AppError("认证会话已失效，请重新登录", 401)
    return result


def get_sessions(user_id: int) -> list[SessionRecord]:
    return get_user_sessions(user_id)


def terminate_session(user_id: int, session_id: int) -> bool:
    sessions = get_user_sessions(user_id)
    target = next((s for s in sessions if s.id == session_id), None)
    if not target:
        return False
    return invalidate_session_by_id(target.id)


def get_current_user(user_id: int) -> SafeUser | None:
    user = find_user_by_id(user_id)
    return _to_safe_user(user) if user else None


def send_sms_code(phone: str, purpose: SmsPurpose = "login", ip_address: str | None = None) -> dict:
    normalized_phone = _normalize_phone(phone)
    now = datetime.now(timezone.utc)
    latest = get_latest_active_sms_code(normalized_phone, purpose)
    if latest and latest.get("created_at"):
        latest_created = _parse_utc_datetime(str(latest["created_at"]))
        cooldown = settings.SMS_RESEND_INTERVAL_SECONDS - int((now - latest_created).total_seconds())
        if cooldown > 0:
            raise AppError(f"验证码发送过于频繁，请在 {cooldown} 秒后重试", 429)

    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    if count_sms_codes_sent_since(normalized_phone, day_start) >= settings.SMS_DAILY_SEND_LIMIT:
        raise AppError("今日验证码发送次数已达上限", 429)

    code = _generate_sms_code()
    expires_at = (now + timedelta(seconds=settings.SMS_CODE_TTL_SECONDS)).isoformat()
    expire_minutes = max(1, math.ceil(settings.SMS_CODE_TTL_SECONDS / 60))

    try:
        send_meta = send_verification_sms(normalized_phone, code, expire_minutes)
    except SmsGatewayError as exc:
        raise AppError(f"短信发送失败: {exc}", 500) from exc

    create_sms_code(
        phone=normalized_phone,
        purpose=purpose,
        code=code,
        expires_at=expires_at,
        ip_address=ip_address,
    )

    payload = {
        "phone": normalized_phone,
        "purpose": purpose,
        "expiresAt": expires_at,
        "provider": settings.SMS_PROVIDER,
        "requestId": send_meta.get("requestId"),
    }
    if settings.ENV != "production" and settings.SMS_PROVIDER == "mock":
        payload["debugCode"] = code
    return payload


def login_or_register_by_phone(phone: str, code: str, user_agent: str | None = None, ip_address: str | None = None) -> dict:
    normalized_phone = _verify_sms_code(phone, code, "login")
    user = find_user_by_phone(normalized_phone)
    if not user:
        user = _create_phone_user(normalized_phone)

    safe_user = _to_safe_user(user)
    result = login_with_session(safe_user, user_agent=user_agent, ip_address=ip_address)
    log_activity(user.id, "login")

    return {
        "user": safe_user,
        "tokens": result["tokens"],
        "kicked_other_devices": user.role != "admin" and result["kicked_other_devices"],
        "revoked_session_ids": result.get("revoked_session_ids", []),
    }


def register_by_phone(phone: str, code: str, user_agent: str | None = None, ip_address: str | None = None) -> dict:
    normalized_phone = _verify_sms_code(phone, code, "register")
    existing_user = find_user_by_phone(normalized_phone)
    if existing_user:
        raise AppError("手机号已被注册", 409)

    user = _create_phone_user(normalized_phone)
    safe_user = _to_safe_user(user)
    result = login_with_session(safe_user, user_agent=user_agent, ip_address=ip_address)
    log_activity(user.id, "login")

    return {
        "user": safe_user,
        "tokens": result["tokens"],
        "kicked_other_devices": False,
        "revoked_session_ids": result.get("revoked_session_ids", []),
    }
