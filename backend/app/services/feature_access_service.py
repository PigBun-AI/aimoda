from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ..config import settings
from ..models import AuthenticatedUser, FeatureAccessStatus, FeatureCode
from ..repositories.feature_usage_repo import get_feature_usage, increment_feature_usage
from ..repositories.subscription_repo import find_active_subscription_by_user_id

FREE_CHAT_LIFETIME_LIMIT = 10
PAID_CHAT_DAILY_LIMIT = 300


def _app_now() -> datetime:
    return datetime.now(ZoneInfo(settings.APP_TIMEZONE))


def _today_period_key() -> str:
    return _app_now().date().isoformat()


def _next_reset_iso() -> str:
    now = _app_now()
    next_day = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return next_day.astimezone(timezone.utc).isoformat()


def _is_paid_user(user_id: int) -> bool:
    return find_active_subscription_by_user_id(user_id) is not None


def get_feature_access_status(user: AuthenticatedUser, feature_code: FeatureCode) -> FeatureAccessStatus:
    if user.role in ("admin", "editor"):
        return FeatureAccessStatus(
            feature_code=feature_code,
            allowed=True,
            reason="admin",
            usage_period_type="none",
            used_count=0,
            limit_count=-1,
            remaining_count=-1,
        )

    is_paid = _is_paid_user(user.id)

    if feature_code == "inspiration":
        return FeatureAccessStatus(
            feature_code=feature_code,
            allowed=True,
            reason="allowed",
            usage_period_type="none",
            used_count=0,
            limit_count=-1,
            remaining_count=-1,
        )

    if feature_code == "fashion_reports":
        return FeatureAccessStatus(
            feature_code=feature_code,
            allowed=is_paid,
            reason="subscriber" if is_paid else "subscription_required",
            usage_period_type="none",
            used_count=0,
            limit_count=-1 if is_paid else 0,
            remaining_count=-1 if is_paid else 0,
        )

    if feature_code == "ai_chat":
        if is_paid:
            period_type = "daily"
            period_key = _today_period_key()
            usage = get_feature_usage(user.id, feature_code, period_type, period_key)
            used_count = usage.used_count if usage else 0
            remaining = max(0, PAID_CHAT_DAILY_LIMIT - used_count)
            return FeatureAccessStatus(
                feature_code=feature_code,
                allowed=remaining > 0,
                reason="subscriber" if remaining > 0 else "limit_exceeded",
                usage_period_type=period_type,
                period_key=period_key,
                used_count=used_count,
                limit_count=PAID_CHAT_DAILY_LIMIT,
                remaining_count=remaining,
                reset_at=_next_reset_iso(),
            )

        period_type = "lifetime"
        period_key = "all_time"
        usage = get_feature_usage(user.id, feature_code, period_type, period_key)
        used_count = usage.used_count if usage else 0
        remaining = max(0, FREE_CHAT_LIFETIME_LIMIT - used_count)
        return FeatureAccessStatus(
            feature_code=feature_code,
            allowed=remaining > 0,
            reason="free_tier" if remaining > 0 else "limit_exceeded",
            usage_period_type=period_type,
            period_key=period_key,
            used_count=used_count,
            limit_count=FREE_CHAT_LIFETIME_LIMIT,
            remaining_count=remaining,
        )

    return FeatureAccessStatus(
        feature_code=feature_code,
        allowed=False,
        reason="subscription_required",
        usage_period_type="none",
        used_count=0,
        limit_count=0,
        remaining_count=0,
    )


def consume_feature_access(user: AuthenticatedUser, feature_code: FeatureCode, *, metadata: dict | None = None) -> FeatureAccessStatus:
    access = get_feature_access_status(user, feature_code)
    if not access.allowed:
        return access

    if access.usage_period_type != "none" and access.limit_count > -1 and access.period_key:
        increment_feature_usage(
            user_id=user.id,
            feature_code=feature_code,
            period_type=access.usage_period_type,
            period_key=access.period_key,
            delta=1,
            metadata=metadata,
        )
        access = get_feature_access_status(user, feature_code)

    return access


def get_user_membership_snapshot(user: AuthenticatedUser) -> dict:
    subscription = find_active_subscription_by_user_id(user.id)
    return {
        "subscription": subscription.model_dump(by_alias=True) if subscription else None,
        "features": {
            "ai_chat": get_feature_access_status(user, "ai_chat").model_dump(by_alias=True),
            "fashion_reports": get_feature_access_status(user, "fashion_reports").model_dump(by_alias=True),
            "inspiration": get_feature_access_status(user, "inspiration").model_dump(by_alias=True),
        },
    }
