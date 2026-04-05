from ..models import ReportViewPermission
from ..repositories.report_view_repo import (
    record_report_view,
)
from ..repositories.subscription_repo import find_active_subscription_by_user_id


def is_subscriber(user_id: int) -> bool:
    return find_active_subscription_by_user_id(user_id) is not None


def _get_remaining_views(user_id: int) -> int:
    return -1 if is_subscriber(user_id) else 0


def check_report_view_permission(user_id: int, report_id: int) -> ReportViewPermission:
    if is_subscriber(user_id):
        return ReportViewPermission(
            canView=True, reason="subscriber", viewsRemaining=-1, totalLimit=-1
        )
    return ReportViewPermission(
        canView=False,
        reason="subscription_required",
        viewsRemaining=0,
        totalLimit=0,
    )


def view_report(user_id: int, report_id: int) -> dict:
    permission = check_report_view_permission(user_id, report_id)
    if not permission.canView:
        return {"success": False, "permission": permission}

    if permission.reason == "subscriber":
        record_report_view(user_id, report_id)
        return {"success": True, "permission": permission}
    return {"success": False, "permission": permission}


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

    return {
        "isUnlimited": False,
        "hasSubscription": False,
        "viewsUsed": 0,
        "viewsRemaining": 0,
        "totalLimit": 0,
    }
