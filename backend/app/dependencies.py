import json
from typing import Annotated

from fastapi import Depends, Header, Request

from .config import settings
from .exceptions import AppError
from .models import AuthenticatedUser, UserRole, FREE_USER_VIEW_LIMIT
from .services.auth_token import verify_access_token
from .repositories.session_repo import is_session_valid
from .repositories.subscription_repo import find_active_subscription_by_user_id
from .repositories.report_view_repo import (
    get_report_view_count,
    has_viewed_report,
    record_report_view,
)


def get_current_user(authorization: Annotated[str | None, Header()] = None) -> AuthenticatedUser:
    """Dependency: extract and verify JWT from Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError("未提供有效的认证令牌", 401)

    token = authorization[len("Bearer "):]

    try:
        user = verify_access_token(token)
    except (ValueError, Exception):
        raise AppError("认证令牌无效或已过期", 401)

    # Validate session is still active (SSO support)
    if user.session_id is not None and not is_session_valid(user.session_id):
        raise AppError("会话已失效，请重新登录", 401)

    return user


def require_report_mcp_internal_service(
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
    x_internal_service: Annotated[str | None, Header(alias="X-Internal-Service")] = None,
) -> str:
    """Dependency: verify service-to-service token for the report MCP adapter."""
    if not x_internal_token or x_internal_token != settings.REPORT_MCP_INTERNAL_TOKEN:
        raise AppError("无效的内部服务令牌", 401)
    return x_internal_service or "unknown"


def require_role(allowed_roles: list[UserRole]):
    """Dependency factory: require specific user roles."""

    def checker(user: Annotated[AuthenticatedUser, Depends(get_current_user)]) -> AuthenticatedUser:
        if user.role not in allowed_roles:
            raise AppError("权限不足", 403)
        return user

    return checker


def extract_device_context(request: Request) -> dict:
    """Extract device info from request headers."""
    cf_ip = request.headers.get("cf-connecting-ip")
    forwarded = request.headers.get("x-forwarded-for")

    ip_address = (
        cf_ip
        if cf_ip
        else (forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None))
    )

    return {
        "user_agent": request.headers.get("user-agent"),
        "ip_address": ip_address,
    }


def check_report_view_permission_dep(report_id: int, user: AuthenticatedUser):
    """Check if user can view a report. Records view if allowed."""
    # Admin and editor have unlimited access
    if user.role in ("admin", "editor"):
        return

    # Subscribers have unlimited access
    if find_active_subscription_by_user_id(user.id) is not None:
        return

    # Already viewed reports can be re-viewed
    if has_viewed_report(user.id, report_id):
        return

    # Check view count limit
    view_count = get_report_view_count(user.id)
    if view_count >= FREE_USER_VIEW_LIMIT:
        raise AppError("已达到免费查看上限", 403)

    # Record the view
    record_report_view(user.id, report_id)
