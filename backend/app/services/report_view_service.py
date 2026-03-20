from ..models import FREE_USER_VIEW_LIMIT, ReportViewPermission
from ..repositories.report_view_repo import (
    get_report_view_count,
    has_viewed_report,
    record_report_view,
)
from ..repositories.subscription_repo import find_active_subscription_by_user_id


def is_subscriber(user_id: int) -> bool:
    return find_active_subscription_by_user_id(user_id) is not None


def _get_remaining_views(user_id: int) -> int:
    if is_subscriber(user_id):
        return -1
    view_count = get_report_view_count(user_id)
    return max(0, FREE_USER_VIEW_LIMIT - view_count)


def check_report_view_permission(user_id: int, report_id: int) -> ReportViewPermission:
    if is_subscriber(user_id):
        return ReportViewPermission(
            canView=True, reason="subscriber", viewsRemaining=-1, totalLimit=-1
        )

    if has_viewed_report(user_id, report_id):
        return ReportViewPermission(
            canView=True,
            reason="already_viewed",
            viewsRemaining=_get_remaining_views(user_id),
            totalLimit=FREE_USER_VIEW_LIMIT,
        )

    view_count = get_report_view_count(user_id)
    remaining = FREE_USER_VIEW_LIMIT - view_count

    if remaining <= 0:
        return ReportViewPermission(
            canView=False,
            reason="limit_exceeded",
            viewsRemaining=0,
            totalLimit=FREE_USER_VIEW_LIMIT,
        )

    return ReportViewPermission(
        canView=True,
        reason="allowed",
        viewsRemaining=remaining - 1,
        totalLimit=FREE_USER_VIEW_LIMIT,
    )


def view_report(user_id: int, report_id: int) -> dict:
    permission = check_report_view_permission(user_id, report_id)
    if not permission.canView:
        return {"success": False, "permission": permission}

    if permission.reason in ("already_viewed", "subscriber"):
        return {"success": True, "permission": permission}

    recorded = record_report_view(user_id, report_id)
    return {"success": recorded, "permission": permission}


def get_view_status(user_id: int, role: str) -> dict:
    if role in ("admin", "editor"):
        return {
            "isUnlimited": True,
            "hasSubscription": False,
            "viewsUsed": 0,
            "viewsRemaining": -1,
            "totalLimit": -1,
        }

    has_sub = is_subscriber(user_id)
    if has_sub:
        return {
            "isUnlimited": True,
            "hasSubscription": True,
            "viewsUsed": 0,
            "viewsRemaining": -1,
            "totalLimit": -1,
        }

    views_used = get_report_view_count(user_id)
    return {
        "isUnlimited": False,
        "hasSubscription": False,
        "viewsUsed": views_used,
        "viewsRemaining": max(0, FREE_USER_VIEW_LIMIT - views_used),
        "totalLimit": FREE_USER_VIEW_LIMIT,
    }
