from __future__ import annotations

import math
import mimetypes
import posixpath
import re
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from fastapi.responses import Response as FastAPIResponse

from ..config import settings
from ..dependencies import check_subscription_access_dep, get_current_user
from ..exceptions import AppError
from ..models import AuthenticatedUser
from ..repositories.session_repo import is_session_valid
from ..repositories.subscription_repo import find_active_subscription_by_user_id
from ..services.auth_token import issue_report_preview_token, verify_report_preview_token
from ..services.oss_service import get_oss_service
from ..services.trend_flow_service import get_trend_flow, get_trend_flows, serialize_trend_flow_public

router = APIRouter(prefix="/trend-flow", tags=["trend-flow"])
TREND_FLOW_PREVIEW_COOKIE_NAME = "aimoda_trend_flow_preview"
TREND_FLOW_HTML_URL_ATTR_PATTERN = re.compile(
    r'(?P<prefix>\b(?:src|href|poster|data-src|data-original|data-full|data-image)=["\'])'
    r'(?P<url>[^"\']+)'
    r'(?P<suffix>["\'])',
    re.IGNORECASE,
)
TREND_FLOW_HTML_SRCSET_PATTERN = re.compile(
    r'(?P<prefix>\bsrcset=["\'])'
    r'(?P<value>[^"\']+)'
    r'(?P<suffix>["\'])',
    re.IGNORECASE,
)
TREND_FLOW_CSS_URL_PATTERN = re.compile(
    r'url\((?P<quote>["\']?)(?P<url>[^)"\']+)(?P=quote)\)',
    re.IGNORECASE,
)
EXTERNAL_URL_PREFIXES = ("http://", "https://", "//", "data:", "mailto:", "tel:", "javascript:", "#")


def _should_secure_preview_cookie() -> bool:
    frontend_url = (settings.FRONTEND_URL or "").lower()
    return frontend_url.startswith("https://")


def _normalize_preview_asset_path(asset_path: str) -> str:
    cleaned = posixpath.normpath(asset_path or "").lstrip("/")
    if not cleaned or cleaned in {".", ".."} or cleaned.startswith("../") or "/../" in f"/{cleaned}":
        raise AppError("非法的趋势流动资源路径", 400)
    return cleaned


def _is_html_asset(normalized_path: str, media_type: str) -> bool:
    return normalized_path.endswith((".html", ".htm")) or media_type.startswith("text/html")


def _is_css_asset(normalized_path: str, media_type: str) -> bool:
    return normalized_path.endswith(".css") or media_type.startswith("text/css")


def _is_browser_document_request(request: Request, normalized_path: str) -> bool:
    sec_fetch_dest = (request.headers.get("sec-fetch-dest") or "").lower()
    accept = (request.headers.get("accept") or "").lower()
    return sec_fetch_dest == "document" or (
        _is_html_asset(normalized_path, "text/html") and "text/html" in accept and sec_fetch_dest != "iframe"
    )


def _redirect_to_trend_flow_shell(trend_flow_id: int) -> RedirectResponse:
    return RedirectResponse(url=f"/trend-flow/{trend_flow_id}", status_code=307)


def _can_access_trend_flow_preview(user: AuthenticatedUser) -> bool:
    if user.role in ("admin", "editor"):
        return True
    return find_active_subscription_by_user_id(user.id) is not None


def _build_public_asset_url(trend_flow, normalized_path: str) -> str:
    oss = get_oss_service()
    oss_path = f"{trend_flow.oss_prefix.rstrip('/')}/{normalized_path}"
    return oss.get_url(oss_path)


def _resolve_asset_ref_path(current_asset_path: str, raw_url: str) -> str | None:
    candidate = (raw_url or "").strip()
    if not candidate or candidate.startswith(EXTERNAL_URL_PREFIXES) or candidate.startswith("?"):
        return None

    base_dir = posixpath.dirname(current_asset_path)
    joined = posixpath.normpath(posixpath.join(base_dir, candidate))
    if not joined or joined in {".", ".."} or joined.startswith("../") or "/../" in f"/{joined}":
        return None
    return joined.lstrip("/")


def _rewrite_html_public_asset_urls(html: bytes, trend_flow, current_asset_path: str) -> bytes:
    html_text = html.decode("utf-8")

    def _replace_attr(match: re.Match[str]) -> str:
        resolved = _resolve_asset_ref_path(current_asset_path, match.group("url"))
        if not resolved:
            return match.group(0)
        public_url = _build_public_asset_url(trend_flow, resolved)
        return f"{match.group('prefix')}{public_url}{match.group('suffix')}"

    def _replace_srcset(match: re.Match[str]) -> str:
        rewritten_items: list[str] = []
        changed = False
        for item in match.group("value").split(","):
            token = item.strip()
            if not token:
                continue
            parts = token.split()
            resolved = _resolve_asset_ref_path(current_asset_path, parts[0])
            if resolved:
                parts[0] = _build_public_asset_url(trend_flow, resolved)
                changed = True
            rewritten_items.append(" ".join(parts))

        if not changed:
            return match.group(0)
        return f"{match.group('prefix')}{', '.join(rewritten_items)}{match.group('suffix')}"

    rewritten = TREND_FLOW_HTML_URL_ATTR_PATTERN.sub(_replace_attr, html_text)
    rewritten = TREND_FLOW_HTML_SRCSET_PATTERN.sub(_replace_srcset, rewritten)
    return rewritten.encode("utf-8")


def _rewrite_css_public_asset_urls(css: bytes, trend_flow, current_asset_path: str) -> bytes:
    css_text = css.decode("utf-8")

    def _replace(match: re.Match[str]) -> str:
        resolved = _resolve_asset_ref_path(current_asset_path, match.group("url"))
        if not resolved:
            return match.group(0)
        quote_char = match.group("quote") or ""
        public_url = _build_public_asset_url(trend_flow, resolved)
        return f"url({quote_char}{public_url}{quote_char})"

    return TREND_FLOW_CSS_URL_PATTERN.sub(_replace, css_text).encode("utf-8")


@router.get("")
def list_public_trend_flows(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=12, ge=1, le=100),
    q: str | None = Query(default=None, max_length=255),
):
    check_subscription_access_dep(user, "开通会员后可查看趋势流动")
    items, total = get_trend_flows(page=page, limit=limit, q=q)
    return {
        "success": True,
        "data": [serialize_trend_flow_public(item) for item in items],
        "meta": {
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/{trend_flow_id}")
def get_single_trend_flow(
    trend_flow_id: int,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    response: Response,
):
    check_subscription_access_dep(user, "开通会员后可查看趋势流动")
    trend_flow = get_trend_flow(trend_flow_id)
    if not trend_flow:
        return {"success": False, "error": "未找到对应趋势流动"}

    response.set_cookie(
        key=TREND_FLOW_PREVIEW_COOKIE_NAME,
        value=issue_report_preview_token(user),
        max_age=settings.REPORT_PREVIEW_TOKEN_TTL_SECONDS,
        httponly=True,
        secure=_should_secure_preview_cookie(),
        samesite="lax",
        path="/api/trend-flow",
    )
    return {"success": True, "data": serialize_trend_flow_public(trend_flow)}


@router.get("/{trend_flow_id}/open")
def open_trend_flow_preview(
    trend_flow_id: int,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    check_subscription_access_dep(user, "开通会员后可查看趋势流动")
    trend_flow = get_trend_flow(trend_flow_id)
    if not trend_flow:
        return {"success": False, "error": "未找到对应趋势流动"}

    redirect = RedirectResponse(url=serialize_trend_flow_public(trend_flow)["previewUrl"], status_code=307)
    redirect.set_cookie(
        key=TREND_FLOW_PREVIEW_COOKIE_NAME,
        value=issue_report_preview_token(user),
        max_age=settings.REPORT_PREVIEW_TOKEN_TTL_SECONDS,
        httponly=True,
        secure=_should_secure_preview_cookie(),
        samesite="lax",
        path="/api/trend-flow",
    )
    return redirect


@router.get("/{trend_flow_id}/preview/{asset_path:path}")
def preview_trend_flow_asset(
    request: Request,
    trend_flow_id: int,
    asset_path: str,
    preview_token: Annotated[str | None, Cookie(alias=TREND_FLOW_PREVIEW_COOKIE_NAME)] = None,
):
    normalized_path = _normalize_preview_asset_path(asset_path)

    if not preview_token:
        if _is_browser_document_request(request, normalized_path):
            return _redirect_to_trend_flow_shell(trend_flow_id)
        raise AppError("预览凭证已失效，请刷新页面重试", 401)

    try:
        user = verify_report_preview_token(preview_token)
    except ValueError as exc:
        if _is_browser_document_request(request, normalized_path):
            return _redirect_to_trend_flow_shell(trend_flow_id)
        raise AppError("预览凭证无效或已过期，请刷新页面重试", 401) from exc

    if user.session_id is not None and not is_session_valid(user.session_id, user.id):
        if _is_browser_document_request(request, normalized_path):
            return _redirect_to_trend_flow_shell(trend_flow_id)
        raise AppError("预览会话已失效，请重新登录", 401)

    if not _can_access_trend_flow_preview(user):
        if _is_browser_document_request(request, normalized_path):
            return _redirect_to_trend_flow_shell(trend_flow_id)
        raise AppError("当前预览凭证无权访问该趋势流动", 403)

    trend_flow = get_trend_flow(trend_flow_id)
    if not trend_flow:
        raise AppError("未找到对应趋势流动", 404)

    oss_path = f"{trend_flow.oss_prefix.rstrip('/')}/{normalized_path}"
    content, media_type = get_oss_service().download_file_with_meta_processed(oss_path)
    content_type = media_type or mimetypes.guess_type(normalized_path)[0] or "application/octet-stream"

    if _is_html_asset(normalized_path, content_type):
        content = _rewrite_html_public_asset_urls(content, trend_flow, normalized_path)
        content_type = "text/html; charset=utf-8"
    elif _is_css_asset(normalized_path, content_type):
        content = _rewrite_css_public_asset_urls(content, trend_flow, normalized_path)
        content_type = "text/css; charset=utf-8"

    return FastAPIResponse(content=content, media_type=content_type)
