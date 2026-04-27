import math
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from ..dependencies import require_role
from ..exceptions import AppError
from ..models import (
    AuthenticatedUser,
    StyleGapStatus,
    UpdateAdminGalleryRequest,
    UpdateAdminReportRequest,
    UpdateAdminTrendFlowRequest,
    UpdateStyleGapRequest,
)
from ..repositories.gallery_repo import list_galleries_admin, update_gallery_admin_fields
from ..repositories.user_repo import count_users, count_users_by_role
from ..services.subscription_service import get_stats as get_subscription_stats
from ..services.activity_service import get_daily_active_percent, get_activity_trend
from ..services.report_service import delete_report_with_files, get_report, get_reports_admin, serialize_report_public, update_report_admin
from ..services.style_feedback_service import (
    get_style_gap_stats_admin,
    list_style_gap_events_admin,
    list_style_gap_feedback_admin,
    update_style_gap_feedback_admin,
)
from ..services.taste_profile_service import (
    TasteProfileNotReadyError,
    get_system_taste_profile_status,
    rebuild_system_taste_profile,
)
from ..services.trend_flow_service import (
    delete_trend_flow_with_files,
    get_trend_flows,
    serialize_trend_flow_public,
    update_trend_flow_admin,
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


@router.get("/reports")
def list_admin_reports(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 12,
    q: Annotated[str | None, Query(max_length=255)] = None,
):
    del user
    reports, total = get_reports_admin(page=page, limit=limit, q=q)
    return {
        "success": True,
        "data": {
            "items": [serialize_report_public(report) for report in reports],
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": math.ceil(total / limit) if limit else 0,
            "q": q or "",
        },
    }


@router.patch("/reports/{report_id}")
def patch_admin_report(
    report_id: int,
    body: UpdateAdminReportRequest,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    updated = update_report_admin(
        report_id,
        title=body.title,
        brand=body.brand,
        season=body.season,
        year=body.year,
        cover_url=body.cover_url,
        lead_excerpt=body.lead_excerpt,
    )
    if updated is None:
        raise AppError("report not found", 404)
    return {"success": True, "data": serialize_report_public(updated)}


@router.delete("/reports/{report_id}")
def delete_admin_report(
    report_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    deleted = delete_report_with_files(report_id)
    if not deleted:
        raise AppError("report not found", 404)
    return {"success": True, "data": {"deleted": True, "reportId": report_id}}


@router.get("/trend-flows")
def list_admin_trend_flows(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 12,
    q: Annotated[str | None, Query(max_length=255)] = None,
):
    del user
    trend_flows, total = get_trend_flows(page=page, limit=limit, q=q)
    return {
        "success": True,
        "data": {
            "items": [serialize_trend_flow_public(item) for item in trend_flows],
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": math.ceil(total / limit) if limit else 0,
            "q": q or "",
        },
    }


@router.patch("/trend-flows/{trend_flow_id}")
def patch_admin_trend_flow(
    trend_flow_id: int,
    body: UpdateAdminTrendFlowRequest,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    updated = update_trend_flow_admin(
        trend_flow_id,
        title=body.title,
        brand=body.brand,
        start_quarter=body.start_quarter,
        start_year=body.start_year,
        end_quarter=body.end_quarter,
        end_year=body.end_year,
        cover_url=body.cover_url,
        lead_excerpt=body.lead_excerpt,
    )
    if updated is None:
        raise AppError("trend flow not found", 404)
    return {"success": True, "data": serialize_trend_flow_public(updated)}


@router.delete("/trend-flows/{trend_flow_id}")
def delete_admin_trend_flow(
    trend_flow_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    deleted = delete_trend_flow_with_files(trend_flow_id)
    if not deleted:
        raise AppError("trend flow not found", 404)
    return {"success": True, "data": {"deleted": True, "trendFlowId": trend_flow_id}}


@router.get("/galleries")
def list_admin_gallery_items(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 12,
    q: Annotated[str | None, Query(max_length=255)] = None,
    status: Annotated[str | None, Query(max_length=32)] = None,
):
    del user
    items, total = list_galleries_admin(page=page, limit=limit, q=q, status=status)
    return {
        "success": True,
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": math.ceil(total / limit) if limit else 0,
            "q": q or "",
            "status": status or "all",
        },
    }


@router.patch("/galleries/{gallery_id}")
def patch_admin_gallery_item(
    gallery_id: str,
    body: UpdateAdminGalleryRequest,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    updated = update_gallery_admin_fields(
        gallery_id,
        title=body.title,
        description=body.description,
        category=body.category,
        tags=body.tags,
        cover_url=body.cover_url,
        status=body.status,
    )
    if updated is None:
        raise AppError("gallery not found", 404)
    return {"success": True, "data": updated}


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


@router.get("/style-gaps/stats")
def get_style_gap_stats(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    return {"success": True, "data": get_style_gap_stats_admin()}


@router.get("/style-gaps/{signal_id}/events")
def get_style_gap_events(
    signal_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    del user
    payload = list_style_gap_events_admin(signal_id=signal_id, limit=limit)
    return {"success": True, "data": {"items": payload, "limit": limit}}


@router.get("/system-dna")
def get_system_dna_status(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    return {"success": True, "data": get_system_taste_profile_status()}


@router.post("/system-dna/rebuild")
def rebuild_system_dna(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    del user
    try:
        payload = rebuild_system_taste_profile()
    except TasteProfileNotReadyError as exc:
        raise AppError(str(exc), 400) from exc
    return {"success": True, "data": payload}
