from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from ..dependencies import require_role
from ..exceptions import AppError
from ..models import AuthenticatedUser, StyleGapStatus, UpdateStyleGapRequest
from ..repositories.user_repo import count_users, count_users_by_role
from ..services.subscription_service import get_stats as get_subscription_stats
from ..services.activity_service import get_daily_active_percent, get_activity_trend
from ..services.style_feedback_service import (
    list_style_gap_feedback_admin,
    update_style_gap_feedback_admin,
)

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


@router.get("/style-gaps")
def list_style_gaps(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
    status: Annotated[StyleGapStatus, Query()] = "open",
    q: Annotated[str | None, Query(max_length=255)] = None,
    min_hits: Annotated[int, Query(ge=1, le=100000)] = 1,
    sort: Annotated[Literal["last_seen", "first_seen", "total_hits"], Query()] = "total_hits",
    order: Annotated[Literal["asc", "desc"], Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    del user
    payload = list_style_gap_feedback_admin(
        status=status,
        q=q,
        min_hits=min_hits,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "data": payload}


@router.patch("/style-gaps/{signal_id}")
def update_style_gap(
    signal_id: str,
    body: UpdateStyleGapRequest,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    payload = update_style_gap_feedback_admin(
        signal_id=signal_id,
        status=body.status,
        linked_style_name=body.linked_style_name,
        resolution_note=body.resolution_note,
        resolved_by=body.resolved_by,
    )
    if payload is None:
        raise AppError("style gap signal not found", 404)

    return {"success": True, "data": payload}
