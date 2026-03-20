from typing import Annotated

from fastapi import APIRouter, Depends

from ..dependencies import require_role
from ..models import AuthenticatedUser
from ..repositories.user_repo import count_users, count_users_by_role
from ..services.subscription_service import get_stats as get_subscription_stats
from ..services.activity_service import get_daily_active_percent, get_activity_trend

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard")
def dashboard(user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))]):
    return {
        "success": True,
        "data": {
            "totalUsers": count_users(),
            "roleDistribution": count_users_by_role(),
            "subscriptionStats": get_subscription_stats(),
            "dauPercent": get_daily_active_percent(),
            "activityTrend": get_activity_trend(30),
        },
    }
