import json
import math
import mimetypes
import posixpath
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
)
from ..services.auth_token import issue_report_preview_token, verify_report_preview_token
from ..services.oss_service import get_oss_service
from ..services.report_upload_job_service import (
    enqueue_report_upload_job,
    get_report_upload_job,
)
from ..services.report_view_service import get_view_status
from ..repositories.activity_repo import log_activity

router = APIRouter(prefix="/reports", tags=["reports"])
REPORT_PREVIEW_COOKIE_NAME = "aimoda_report_preview"
REPORT_PREVIEW_THUMB_MAX_EDGE = 1024
REPORT_PREVIEW_THUMB_QUALITY = 85


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


def _is_html_asset(normalized_path: str, media_type: str) -> bool:
    return normalized_path.endswith((".html", ".htm")) or media_type.startswith("text/html")


def _is_resizable_image(media_type: str) -> bool:
    return media_type.startswith("image/") and media_type not in {"image/svg+xml", "image/gif"}


def _build_oss_image_process(max_edge: int) -> str:
    return (
        "image/resize,"
        f"m_lfit,w_{max_edge},h_{max_edge}"
        f"/quality,q_{REPORT_PREVIEW_THUMB_QUALITY}"
        "/auto-orient,1"
    )


def _inject_report_preview_patch(html: bytes, report_id: int) -> bytes:
    patch_script = f"""
<script data-aimoda-report-preview-patch>
(() => {{
  const selector = '.hero-image, .img-item img, img.img-item';
  const previewPrefix = `/api/reports/{report_id}/preview/`;
  const thumbMaxEdge = '{REPORT_PREVIEW_THUMB_MAX_EDGE}';

  const isOptimizable = (value) => {{
    if (!value) return false;
    try {{
      const url = new URL(value, window.location.href);
      const pathname = url.pathname || '';
      return url.origin === window.location.origin
        && pathname.startsWith(previewPrefix)
        && !pathname.endsWith('.svg')
        && !pathname.endsWith('.gif');
    }} catch (_error) {{
      return false;
    }}
  }};

  const withThumbParams = (value) => {{
    const url = new URL(value, window.location.href);
    url.searchParams.set('max_edge', thumbMaxEdge);
    return url.toString();
  }};

  const optimizeImages = () => {{
    document.querySelectorAll(selector).forEach((img, index) => {{
      const resolvedSrc = img.currentSrc || img.src;
      if (!isOptimizable(resolvedSrc)) return;

      if (!img.dataset.fullresSrc) {{
        img.dataset.fullresSrc = resolvedSrc;
      }}

      if (img.classList.contains('hero-image')) {{
        img.loading = 'eager';
        img.fetchPriority = index === 0 ? 'high' : 'auto';
      }} else {{
        img.loading = 'lazy';
      }}
      img.decoding = 'async';

      const thumbSrc = withThumbParams(img.dataset.fullresSrc);
      if (img.src !== thumbSrc) {{
        img.src = thumbSrc;
      }}
    }});
  }};

  getAllImages = function getAllImagesPatched() {{
    return Array.from(document.querySelectorAll(selector)).map((img, index) => ({{
      src: img.dataset.fullresSrc || img.currentSrc || img.src,
      alt: img.alt || `Image ${{index + 1}}`,
    }}));
  }};

  downloadImage = function downloadImagePatched() {{
    const img = allImages?.[currentIndex];
    if (!img) return;
    const link = document.createElement('a');
    link.href = img.src;
    link.download = (img.alt || 'image') + '.jpg';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }};

  const bindMissingLightboxListeners = () => {{
    const images = Array.from(document.querySelectorAll(selector));
    images.forEach((img) => {{
      if (img.matches('.hero-image, .img-item img')) return;
      if (img.dataset.aimodaLightboxBound === '1') return;
      img.dataset.aimodaLightboxBound = '1';
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (event) => {{
        event.stopPropagation();
        const currentImages = Array.from(document.querySelectorAll(selector));
        const lightboxIndex = currentImages.indexOf(img);
        if (lightboxIndex >= 0 && typeof window.openLightbox === 'function') {{
          window.openLightbox(lightboxIndex);
        }}
      }});
    }});
  }};

  optimizeImages();
  bindMissingLightboxListeners();
}})();
</script>
"""
    html_text = html.decode("utf-8")
    if "data-aimoda-report-preview-patch" in html_text:
        return html
    if "</body>" in html_text:
        return html_text.replace("</body>", f"{patch_script}</body>", 1).encode("utf-8")
    return f"{html_text}{patch_script}".encode("utf-8")


def _can_access_report_preview(user: AuthenticatedUser, report_id: int) -> bool:
    if user.role in ("admin", "editor"):
        return True
    if find_active_subscription_by_user_id(user.id) is not None:
        return True
    return has_viewed_report(user.id, report_id)


def _can_access_upload_job(user: AuthenticatedUser, uploaded_by: int) -> bool:
    if user.role in ("admin", "editor"):
        return True
    return user.id == uploaded_by


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


@router.get("/upload-jobs/{job_id}")
def get_upload_job_status(
    job_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin", "editor"]))],
):
    job = get_report_upload_job(job_id)
    if not job:
        return {"success": False, "error": "未找到对应上传任务"}
    if not _can_access_upload_job(user, job.uploaded_by):
        return {"success": False, "error": "无权查看该上传任务"}

    return {"success": True, "data": job.model_dump(by_alias=True)}


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
    max_edge: Annotated[int | None, Query(ge=256, le=2048)] = None,
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
    process: str | None = None

    try:
        if max_edge:
            guessed_media_type = mimetypes.guess_type(normalized_path)[0] or ""
            if _is_resizable_image(guessed_media_type):
                process = _build_oss_image_process(max_edge)
        content, content_type = oss.download_file_with_meta_processed(oss_path, process=process)
    except oss2.exceptions.NoSuchKey as exc:
        raise AppError("报告资源不存在", 404) from exc

    media_type = content_type or mimetypes.guess_type(normalized_path)[0] or "application/octet-stream"
    if _is_html_asset(normalized_path, media_type):
        content = _inject_report_preview_patch(content, report_id)

    return FastAPIResponse(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/upload", status_code=202)
async def upload_report(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin", "editor"]))],
    file: UploadFile = File(...),
):
    if not file.filename:
        return {"success": False, "error": "未提供上传文件"}

    content = await file.read()
    if not content:
        return {"success": False, "error": "上传文件为空"}

    job = enqueue_report_upload_job(
        filename=file.filename,
        file_bytes=content,
        uploaded_by=user.id,
    )

    return {
        "success": True,
        "message": "报告上传任务已开始处理",
        "data": job.model_dump(by_alias=True),
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
