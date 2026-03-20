import os
from datetime import datetime, timedelta, timezone

from ..database import get_db
from ..exceptions import AppError
from ..models import RedemptionCodeRecord, RedemptionCodeType, SubscriptionRecord
from ..repositories.activity_repo import log_activity
from ..repositories.redemption_code_repo import (
    create_redemption_code,
    find_code_by_code,
    list_codes,
    mark_code_used,
)
from ..repositories.subscription_repo import create_subscription

_TYPE_TO_DAYS: dict[str, int] = {
    "1week": 7,
    "1month": 30,
    "3months": 90,
    "1year": 365,
}


def generate_codes(code_type: RedemptionCodeType, count: int, created_by: int) -> list[RedemptionCodeRecord]:
    codes: list[RedemptionCodeRecord] = []
    for _ in range(count):
        code = os.urandom(16).hex()
        days = _TYPE_TO_DAYS[code_type]
        expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        record = create_redemption_code(
            code=code, code_type=code_type, created_by=created_by, expires_at=expires_at
        )
        codes.append(record)
    return codes


def redeem_code(code_str: str, user_id: int) -> SubscriptionRecord:
    code = find_code_by_code(code_str)
    if not code or code.status != "unused":
        raise AppError("兑换码无效或已使用", 400)

    if datetime.fromisoformat(code.expires_at) < datetime.now(timezone.utc):
        raise AppError("兑换码已过期", 400)

    now = datetime.now(timezone.utc)
    days = _TYPE_TO_DAYS[code.type]
    ends_at = now + timedelta(days=days)

    # Transaction: mark code + create subscription + log activity
    mark_code_used(code.id, user_id)
    subscription = create_subscription(
        user_id=user_id,
        starts_at=now.isoformat(),
        ends_at=ends_at.isoformat(),
        source_code_id=code.id,
    )
    log_activity(user_id, "redeem_code")

    return subscription


def get_codes() -> list[RedemptionCodeRecord]:
    return list_codes()
