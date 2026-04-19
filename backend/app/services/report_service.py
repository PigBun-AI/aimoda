"""
Report Service — business logic for report operations.

Handles upload (zip → extract → OSS → PostgreSQL), listing, and deletion.
"""

import json
import logging
import shutil
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import psycopg

from ..config import settings
from ..constants import OPENCLAW_REPORT_TEMPLATE, OPENCLAW_UPLOAD_CONTRACT, REPORT_SPEC
from ..exceptions import AppError
from ..models import ReportRecord
from ..repositories.report_repo import (
    create_report,
    find_report_by_id,
    find_report_by_slug,
    list_reports,
    list_reports_admin,
    update_report_admin_fields,
    update_report_metadata,
)
from .report_scanner import extract_report_metadata, extract_report_lead_excerpt
from .report_uploader import upload_report_to_oss
from .oss_service import get_oss_service

logger = logging.getLogger(__name__)


def get_report_spec() -> dict:
    return REPORT_SPEC


def get_openclaw_upload_contract() -> dict:
    return OPENCLAW_UPLOAD_CONTRACT


def get_openclaw_report_template() -> dict:
    return OPENCLAW_REPORT_TEMPLATE


def get_report(report_id: int) -> ReportRecord | None:
    return find_report_by_id(report_id)


def get_reports(page: int = 1, limit: int = 12, q: str | None = None) -> tuple[list[ReportRecord], int]:
    return list_reports(page=page, limit=limit, q=q)


def get_reports_admin(page: int = 1, limit: int = 20, q: str | None = None) -> tuple[list[ReportRecord], int]:
    return list_reports_admin(page=page, limit=limit, q=q)


def _parse_report_metadata_json(metadata_json: str | None) -> dict:
    if not metadata_json:
        return {}
    try:
        payload = json.loads(metadata_json)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _resolve_report_entry_path(report: ReportRecord, metadata: dict | None = None) -> str:
    payload = metadata or _parse_report_metadata_json(report.metadata_json)
    entry_html = payload.get("entryHtml") or payload.get("entry_html")
    if isinstance(entry_html, str) and entry_html.strip():
        return entry_html.strip().lstrip("/")

    parsed = urlsplit(report.index_url or "")
    candidate_path = unquote(parsed.path)
    marker = f"/reports/{report.slug}/"
    if marker in candidate_path:
        return candidate_path.split(marker, 1)[1].lstrip("/")

    return "index.html"


def resolve_report_lead_excerpt(report: ReportRecord) -> str | None:
    metadata = _parse_report_metadata_json(report.metadata_json)
    existing = metadata.get("lead_excerpt") or metadata.get("leadExcerpt")
    if isinstance(existing, str) and existing.strip():
        return existing.strip()

    if not report.oss_prefix:
        return None

    entry_path = _resolve_report_entry_path(report, metadata)
    oss_path = f"{report.oss_prefix.rstrip('/')}/{entry_path.lstrip('/')}"

    try:
        content, content_type = get_oss_service().download_file_with_meta_processed(oss_path)
    except Exception as exc:
        logger.warning("Failed to backfill report lead excerpt for report %s: %s", report.slug, exc)
        return None

    if content_type and "html" not in content_type.lower() and not entry_path.lower().endswith((".html", ".htm")):
        return None

    html = content.decode("utf-8", errors="ignore")
    excerpt = extract_report_lead_excerpt(html)
    if not excerpt:
        return None

    next_metadata = {**metadata, "lead_excerpt": excerpt}
    try:
        update_report_metadata(report.id, next_metadata)
    except Exception as exc:
        logger.warning("Failed to persist report lead excerpt for report %s: %s", report.slug, exc)

    return excerpt


def serialize_report_public(report: ReportRecord) -> dict:
    payload = report.model_dump(by_alias=True)
    entry_path = _resolve_report_entry_path(report)
    payload["previewUrl"] = f"/api/reports/{report.id}/preview/{quote(entry_path, safe='/')}"
    payload["leadExcerpt"] = resolve_report_lead_excerpt(report)
    payload["status"] = "published"
    return payload


def update_report_admin(
    report_id: int,
    *,
    title: str | None = None,
    brand: str | None = None,
    season: str | None = None,
    year: int | None = None,
    cover_url: str | None = None,
    lead_excerpt: str | None = None,
) -> ReportRecord | None:
    current = find_report_by_id(report_id)
    if current is None:
        return None

    metadata = _parse_report_metadata_json(current.metadata_json)
    metadata_dirty = False

    if lead_excerpt is not None:
        normalized_excerpt = lead_excerpt.strip()
        if normalized_excerpt:
            metadata["lead_excerpt"] = normalized_excerpt
        else:
            metadata.pop("lead_excerpt", None)
            metadata.pop("leadExcerpt", None)
        metadata_dirty = True

    return update_report_admin_fields(
        report_id,
        title=title.strip() if isinstance(title, str) else None,
        brand=brand.strip() if isinstance(brand, str) else None,
        season=season.strip() if isinstance(season, str) else None,
        year=year,
        cover_url=cover_url.strip() if isinstance(cover_url, str) else None,
        metadata_json=metadata if metadata_dirty else None,
    )


def _delete_report_records(report_id: int) -> bool:
    with psycopg.connect(settings.POSTGRES_DSN) as conn:
        conn.execute("UPDATE report_upload_jobs SET report_id = NULL WHERE report_id = %s", (report_id,))
        conn.execute("DELETE FROM report_views WHERE report_id = %s", (report_id,))
        result = conn.execute("DELETE FROM reports WHERE id = %s", (report_id,))
        conn.commit()
        return result.rowcount > 0


def delete_report_with_files(report_id: int) -> bool:
    """Delete a report from the database AND its OSS files."""
    report = find_report_by_id(report_id)
    if not report:
        return False

    deleted = _delete_report_records(report_id)
    if deleted and report.oss_prefix:
        # Clean up OSS files
        try:
            oss = get_oss_service()
            count = oss.delete_prefix(report.oss_prefix)
            import logging
            logging.getLogger(__name__).info(
                "Deleted %d OSS files for report %s (prefix: %s)",
                count, report.slug, report.oss_prefix,
            )
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(
                "Failed to delete OSS files for report %s: %s", report.slug, e,
            )
    return deleted


def _safe_join(base: Path, target: str) -> Path:
    """Ensure target path doesn't escape base directory."""
    resolved = (base / target).resolve()
    base_resolved = base.resolve()
    try:
        resolved.relative_to(base_resolved)
    except ValueError:
        raise AppError("压缩包包含非法路径", 400)
    return resolved


def _extract_archive(archive_path: Path, dest: Path) -> None:
    """Extract zip archive to destination directory."""
    with zipfile.ZipFile(archive_path, "r") as zf:
        for info in zf.infolist():
            output_path = _safe_join(dest, info.filename)
            if info.is_dir():
                output_path.mkdir(parents=True, exist_ok=True)
            else:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(output_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)


def _resolve_report_root(extraction_dir: Path) -> Path:
    """If extracted into a single subfolder, use that as root.

    Only descend when the archive root contains no real files. This avoids
    mis-detecting valid flat zips like:

      manifest.json
      pages/report.html

    where `pages/` would otherwise look like the only child directory.
    """
    children = [c for c in extraction_dir.iterdir() if c.is_dir()]
    root_files = [c for c in extraction_dir.iterdir() if c.is_file()]
    if len(children) == 1 and not root_files:
        return children[0]
    return extraction_dir


def upload_report_archive(archive_path: str, uploaded_by: int) -> ReportRecord:
    """Upload a report zip archive: extract → OSS → PostgreSQL.

    Flow:
      1. Extract zip to temp directory
      2. Validate and extract metadata
      3. Check for duplicate slug
      4. Upload images + modified HTML to OSS
      5. Register in PostgreSQL
      6. Clean up temp files
    """
    upload_tmp_dir = settings.resolved_upload_tmp_dir
    upload_tmp_dir.mkdir(parents=True, exist_ok=True)

    extraction_dir = Path(tempfile.mkdtemp(prefix="report-", dir=str(upload_tmp_dir)))

    try:
        # 1. Extract
        _extract_archive(Path(archive_path), extraction_dir)
        report_root = _resolve_report_root(extraction_dir)

        # 2. Validate and extract metadata
        metadata = extract_report_metadata(report_root)

        # 3. Check for duplicate slug
        existing = find_report_by_slug(metadata.slug)
        if existing:
            raise AppError(f"报告 slug 已存在: {metadata.slug}", 409)

        # 4. Upload to OSS (images + modified HTML)
        oss_result = upload_report_to_oss(report_root, metadata.slug)

        # 5. Register in PostgreSQL
        report = create_report(
            slug=metadata.slug,
            title=metadata.title,
            brand=metadata.brand,
            season=metadata.season,
            year=metadata.year,
            look_count=metadata.look_count,
            index_url=oss_result.index_url,
            overview_url=oss_result.overview_url,
            cover_url=oss_result.cover_url,
            oss_prefix=oss_result.oss_prefix,
            uploaded_by=uploaded_by,
            metadata_json=metadata.model_dump(),
        )

        return report

    finally:
        # 6. Clean up
        shutil.rmtree(extraction_dir, ignore_errors=True)
        archive = Path(archive_path)
        if archive.exists():
            archive.unlink(missing_ok=True)
