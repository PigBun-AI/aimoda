import json
import math
import mimetypes
import posixpath
import re
from urllib.parse import quote, unquote, urlsplit
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response, UploadFile, File, Query
from fastapi.responses import Response as FastAPIResponse
from fastapi.responses import RedirectResponse

import oss2

from ..config import settings
from ..dependencies import (
    check_report_view_permission_dep,
    get_current_user,
    require_role,
)
from ..exceptions import AppError
from ..models import AuthenticatedUser
from ..repositories.session_repo import is_session_valid
from ..repositories.subscription_repo import find_active_subscription_by_user_id
from ..services.report_service import (
    get_report,
    get_report_spec,
    get_reports,
    delete_report_with_files,
    resolve_report_lead_excerpt,
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
REPORT_PREVIEW_THUMB_MAX_EDGE = 1280
REPORT_PREVIEW_THUMB_QUALITY = 85
REPORT_HTML_URL_ATTR_PATTERN = re.compile(
    r'(?P<prefix>\b(?:src|href|poster|data-src|data-original|data-full|data-image)=["\'])'
    r'(?P<url>[^"\']+)'
    r'(?P<suffix>["\'])',
    re.IGNORECASE,
)
REPORT_HTML_SRCSET_PATTERN = re.compile(
    r'(?P<prefix>\bsrcset=["\'])'
    r'(?P<value>[^"\']+)'
    r'(?P<suffix>["\'])',
    re.IGNORECASE,
)
REPORT_CSS_URL_PATTERN = re.compile(
    r'url\((?P<quote>["\']?)(?P<url>[^)"\']+)(?P=quote)\)',
    re.IGNORECASE,
)
EXTERNAL_URL_PREFIXES = ("http://", "https://", "//", "data:", "mailto:", "tel:", "javascript:", "#")


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


def _serialize_report(report) -> dict:
    payload = report.model_dump(by_alias=True)
    payload["previewUrl"] = _build_report_preview_url(report)
    payload["leadExcerpt"] = resolve_report_lead_excerpt(report)
    return payload


def _normalize_preview_asset_path(asset_path: str) -> str:
    cleaned = posixpath.normpath(asset_path or "").lstrip("/")
    if not cleaned or cleaned in {".", ".."} or cleaned.startswith("../") or "/../" in f"/{cleaned}":
        raise AppError("非法的报告资源路径", 400)
    return cleaned


def _is_html_asset(normalized_path: str, media_type: str) -> bool:
    return normalized_path.endswith((".html", ".htm")) or media_type.startswith("text/html")


def _is_css_asset(normalized_path: str, media_type: str) -> bool:
    return normalized_path.endswith(".css") or media_type.startswith("text/css")


def _is_resizable_image(media_type: str) -> bool:
    return media_type.startswith("image/") and media_type not in {"image/svg+xml", "image/gif"}


def _build_oss_image_process(max_edge: int) -> str:
    return (
        "image/resize,"
        f"m_lfit,w_{max_edge},h_{max_edge}"
        f"/quality,q_{REPORT_PREVIEW_THUMB_QUALITY}"
        "/auto-orient,1"
    )


def _append_oss_process(url: str, process: str) -> str:
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}x-oss-process={quote(process, safe='')}"


def _build_public_report_asset_url(report, normalized_path: str, *, process: str | None = None) -> str:
    oss = get_oss_service()
    oss_path = f"{report.oss_prefix.rstrip('/')}/{normalized_path}"
    public_url = oss.get_url(oss_path)
    if process:
        return _append_oss_process(public_url, process)
    return public_url


def _resolve_report_asset_ref_path(current_asset_path: str, raw_url: str) -> str | None:
    candidate = (raw_url or "").strip()
    if not candidate or candidate.startswith(EXTERNAL_URL_PREFIXES) or candidate.startswith("?"):
        return None

    parsed = urlsplit(candidate)
    path = (parsed.path or "").strip()
    if not path:
        return None

    if path.startswith("/"):
        joined = posixpath.normpath(path.lstrip("/"))
    else:
        base_dir = posixpath.dirname(current_asset_path)
        joined = posixpath.normpath(posixpath.join(base_dir, path))

    if not joined or joined in {".", ".."} or joined.startswith("../") or "/../" in f"/{joined}":
        return None
    return joined.lstrip("/")


def _rewrite_html_public_asset_urls(html: bytes, report, current_asset_path: str) -> bytes:
    html_text = html.decode("utf-8")

    def _replace_attr(match: re.Match[str]) -> str:
        raw_url = match.group("url")
        resolved = _resolve_report_asset_ref_path(current_asset_path, raw_url)
        if not resolved:
            return match.group(0)

        media_type = mimetypes.guess_type(resolved)[0] or ""
        if not media_type.startswith("image/"):
            return match.group(0)

        public_url = _build_public_report_asset_url(report, resolved)
        return f"{match.group('prefix')}{public_url}{match.group('suffix')}"

    def _replace_srcset(match: re.Match[str]) -> str:
        rewritten_items: list[str] = []
        changed = False

        for item in match.group("value").split(","):
            token = item.strip()
            if not token:
                continue
            parts = token.split()
            raw_url = parts[0]
            resolved = _resolve_report_asset_ref_path(current_asset_path, raw_url)
            if resolved:
                media_type = mimetypes.guess_type(resolved)[0] or ""
                if media_type.startswith("image/"):
                    parts[0] = _build_public_report_asset_url(report, resolved)
                    changed = True
            rewritten_items.append(" ".join(parts))

        if not changed:
            return match.group(0)
        return f"{match.group('prefix')}{', '.join(rewritten_items)}{match.group('suffix')}"

    rewritten = REPORT_HTML_URL_ATTR_PATTERN.sub(_replace_attr, html_text)
    rewritten = REPORT_HTML_SRCSET_PATTERN.sub(_replace_srcset, rewritten)
    return rewritten.encode("utf-8")


def _rewrite_css_public_asset_urls(css: bytes, report, current_asset_path: str) -> bytes:
    css_text = css.decode("utf-8")

    def _replace(match: re.Match[str]) -> str:
        raw_url = match.group("url")
        resolved = _resolve_report_asset_ref_path(current_asset_path, raw_url)
        if not resolved:
            return match.group(0)

        media_type = mimetypes.guess_type(resolved)[0] or ""
        if not media_type.startswith("image/"):
            return match.group(0)

        quote_char = match.group("quote") or ""
        public_url = _build_public_report_asset_url(report, resolved)
        return f"url({quote_char}{public_url}{quote_char})"

    return REPORT_CSS_URL_PATTERN.sub(_replace, css_text).encode("utf-8")


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
    return find_active_subscription_by_user_id(user.id) is not None


def _can_access_upload_job(user: AuthenticatedUser, uploaded_by: int) -> bool:
    if user.role in ("admin", "editor"):
        return True
    return user.id == uploaded_by


def _set_report_preview_cookie(response: Response, user: AuthenticatedUser) -> None:
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


@router.get("")
def list_reports(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    response: Response,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=12, ge=1, le=100),
):
    reports, total = get_reports(page, limit)
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
    return {
        "success": True,
        "data": [
            _serialize_report(r)
            for r in reports
        ],
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
    _set_report_preview_cookie(response, user)

    report_data = _serialize_report(report)

    return {
        "success": True,
        "data": report_data,
        "meta": {"viewStatus": view_stat},
    }


@router.get("/{report_id}/open")
def open_report_preview(
    report_id: int,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    check_report_view_permission_dep(report_id, user)

    report = get_report(report_id)
    if not report:
        return {"success": False, "error": "未找到对应报告"}

    log_activity(user.id, "view_report")

    response = RedirectResponse(
        url=_build_report_preview_url(report),
        status_code=307,
    )
    _set_report_preview_cookie(response, user)
    return response


@router.get("/{report_id}/launch")
def launch_report_preview(
    report_id: int,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Set preview auth and jump straight into the report HTML in a new tab."""
    check_report_view_permission_dep(report_id, user)

    report = get_report(report_id)
    if not report:
        return {"success": False, "error": "未找到对应报告"}

    log_activity(user.id, "view_report")

    redirect = RedirectResponse(url=_build_report_preview_url(report), status_code=307)
    redirect.set_cookie(
        key=REPORT_PREVIEW_COOKIE_NAME,
        value=issue_report_preview_token(user),
        max_age=settings.REPORT_PREVIEW_TOKEN_TTL_SECONDS,
        httponly=True,
        secure=_should_secure_preview_cookie(),
        samesite="lax",
        path="/api/reports",
    )
    return redirect


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
    if user.session_id is not None and not is_session_valid(user.session_id, user.id):
        raise AppError("预览会话已失效，请重新登录", 401)

    report = get_report(report_id)
    if not report:
        raise AppError("未找到对应报告", 404)

    if not _can_access_report_preview(user, report_id):
        raise AppError("当前预览凭证无权访问该报告", 403)

    normalized_path = _normalize_preview_asset_path(asset_path)
    guessed_media_type = mimetypes.guess_type(normalized_path)[0] or ""

    if _is_resizable_image(guessed_media_type):
        process = _build_oss_image_process(max_edge) if max_edge else None
        return RedirectResponse(
            url=_build_public_report_asset_url(report, normalized_path, process=process),
            status_code=307,
            headers={"Cache-Control": "public, max-age=3600"},
        )

    oss_path = f"{report.oss_prefix.rstrip('/')}/{normalized_path}"
    oss = get_oss_service()

    try:
        content, content_type = oss.download_file_with_meta_processed(oss_path)
    except oss2.exceptions.NoSuchKey as exc:
        raise AppError("报告资源不存在", 404) from exc

    media_type = content_type or guessed_media_type or "application/octet-stream"
    if _is_css_asset(normalized_path, media_type):
        content = _rewrite_css_public_asset_urls(content, report, normalized_path)
    if _is_html_asset(normalized_path, media_type):
        content = _rewrite_html_public_asset_urls(content, report, normalized_path)
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
