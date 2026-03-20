from ..repositories.subscription_repo import (
    find_active_subscription_by_user_id,
    get_subscription_stats,
)
from ..models import SubscriptionRecord


def get_user_subscription(user_id: int) -> SubscriptionRecord | None:
    return find_active_subscription_by_user_id(user_id)


def get_stats() -> dict:
    return get_subscription_stats()
