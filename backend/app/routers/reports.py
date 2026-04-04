import json
import math
import mimetypes
import posixpath
import tempfile
from urllib.parse import quote, unquote, urlsplit
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response, UploadFile, File, Query
from fastapi.responses import Response as FastAPIResponse

import oss2

from ..config import settings
from ..dependencies import (
    check_report_view_permission_dep,
    get_current_user,
    require_role,
)
from ..exceptions import AppError
from ..models import AuthenticatedUser
from ..repositories.report_view_repo import has_viewed_report
from ..repositories.session_repo import is_session_valid
from ..repositories.subscription_repo import find_active_subscription_by_user_id
from ..services.report_service import (
    get_report,
    get_report_spec,
    get_reports,
    delete_report_with_files,
    upload_report_archive,
)
from ..services.auth_token import issue_report_preview_token, verify_report_preview_token
from ..services.oss_service import get_oss_service
from ..services.report_view_service import get_view_status
from ..repositories.activity_repo import log_activity

router = APIRouter(prefix="/reports", tags=["reports"])
REPORT_PREVIEW_COOKIE_NAME = "aimoda_report_preview"


def _should_secure_preview_cookie() -> bool:
    frontend_url = (settings.FRONTEND_URL or "").lower()
    return frontend_url.startswith("https://")


def _get_report_entry_path(report) -> str:
    if report.metadata_json:
        try:
            payload = json.loads(report.metadata_json)
            entry_html = payload.get("entryHtml") or payload.get("entry_html")
            if isinstance(entry_html, str) and entry_html.strip():
                return entry_html.strip().lstrip("/")
        except json.JSONDecodeError:
            pass

    parsed = urlsplit(report.index_url or "")
    candidate_path = unquote(parsed.path)
    marker = f"/reports/{report.slug}/"
    if marker in candidate_path:
        return candidate_path.split(marker, 1)[1].lstrip("/")

    return "index.html"


def _build_report_preview_url(report) -> str:
    entry_path = _get_report_entry_path(report)
    return f"/api/reports/{report.id}/preview/{quote(entry_path, safe='/')}"


def _normalize_preview_asset_path(asset_path: str) -> str:
    cleaned = posixpath.normpath(asset_path or "").lstrip("/")
    if not cleaned or cleaned in {".", ".."} or cleaned.startswith("../") or "/../" in f"/{cleaned}":
        raise AppError("非法的报告资源路径", 400)
    return cleaned


def _can_access_report_preview(user: AuthenticatedUser, report_id: int) -> bool:
    if user.role in ("admin", "editor"):
        return True
    if find_active_subscription_by_user_id(user.id) is not None:
        return True
    return has_viewed_report(user.id, report_id)


@router.get("")
def list_reports(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=12, ge=1, le=100),
):
    reports, total = get_reports(page, limit)
    return {
        "success": True,
        "data": [r.model_dump(by_alias=True) for r in reports],
        "meta": {
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/view-status")
def view_status(user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
    status = get_view_status(user.id, user.role)
    return {"success": True, "data": status}


@router.get("/spec")
def report_spec():
    return {"success": True, "data": get_report_spec()}


@router.get("/{report_id}")
def get_single_report(
    report_id: int,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    response: Response,
):
    # Check view permission (records view if applicable)
    check_report_view_permission_dep(report_id, user)

    report = get_report(report_id)
    if not report:
        return {"success": False, "error": "未找到对应报告"}

    log_activity(user.id, "view_report")

    view_stat = get_view_status(user.id, user.role)
    preview_token = issue_report_preview_token(user)
    response.set_cookie(
        key=REPORT_PREVIEW_COOKIE_NAME,
        value=preview_token,
        max_age=settings.REPORT_PREVIEW_TOKEN_TTL_SECONDS,
        httponly=True,
        secure=_should_secure_preview_cookie(),
        samesite="lax",
        path="/api/reports",
    )

    report_data = report.model_dump(by_alias=True)
    report_data["previewUrl"] = _build_report_preview_url(report)

    return {
        "success": True,
        "data": report_data,
        "meta": {"viewStatus": view_stat},
    }


@router.get("/{report_id}/preview/{asset_path:path}")
def preview_report_asset(
    report_id: int,
    asset_path: str,
    preview_token: Annotated[str | None, Cookie(alias=REPORT_PREVIEW_COOKIE_NAME)] = None,
):
    if not preview_token:
        raise AppError("预览凭证已失效，请刷新页面重试", 401)

    try:
        user = verify_report_preview_token(preview_token)
    except ValueError as exc:
        raise AppError("预览凭证无效或已过期，请刷新页面重试", 401) from exc
    if user.session_id is not None and not is_session_valid(user.session_id):
        raise AppError("预览会话已失效，请重新登录", 401)

    report = get_report(report_id)
    if not report:
        raise AppError("未找到对应报告", 404)

    if not _can_access_report_preview(user, report_id):
        raise AppError("当前预览凭证无权访问该报告", 403)

    normalized_path = _normalize_preview_asset_path(asset_path)
    oss_path = f"{report.oss_prefix.rstrip('/')}/{normalized_path}"
    oss = get_oss_service()

    try:
        content, content_type = oss.download_file_with_meta(oss_path)
    except oss2.exceptions.NoSuchKey as exc:
        raise AppError("报告资源不存在", 404) from exc

    media_type = content_type or mimetypes.guess_type(normalized_path)[0] or "application/octet-stream"
    return FastAPIResponse(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/upload", status_code=201)
async def upload_report(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin", "editor"]))],
    file: UploadFile = File(...),
):
    if not file.filename:
        return {"success": False, "error": "未提供上传文件"}

    # Save uploaded file to temp location
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    report = upload_report_archive(archive_path=tmp_path, uploaded_by=user.id)

    return {
        "success": True,
        "message": "报告上传成功",
        "report": {
            "id": report.id,
            "slug": report.slug,
            "title": report.title,
            "brand": report.brand,
            "season": f"{report.season} {report.year}",
            "lookCount": report.look_count,
            "indexUrl": report.index_url,
            "overviewUrl": report.overview_url,
            "coverUrl": report.cover_url,
        },
    }


@router.delete("/{report_id}")
def delete_report(
    report_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    deleted = delete_report_with_files(report_id)
    if not deleted:
        return {"success": False, "error": "未找到对应报告"}
    return {"success": True, "message": "报告删除成功"}
