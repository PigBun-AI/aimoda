"""
Report Service — business logic for report operations.

Handles upload (zip → extract → OSS → PostgreSQL), listing, and deletion.
"""

import json
import shutil
import tempfile
import zipfile
from pathlib import Path

from ..config import settings
from ..constants import REPORT_SPEC
from ..exceptions import AppError
from ..models import ReportRecord
from ..repositories.report_repo import (
    create_report,
    delete_report_by_id,
    find_report_by_id,
    find_report_by_slug,
    list_reports,
)
from .report_scanner import extract_report_metadata
from .report_uploader import upload_report_to_oss
from .oss_service import get_oss_service


def get_report_spec() -> dict:
    return REPORT_SPEC


def get_report(report_id: int) -> ReportRecord | None:
    return find_report_by_id(report_id)


def get_reports(page: int = 1, limit: int = 12) -> tuple[list[ReportRecord], int]:
    return list_reports(page, limit)


def delete_report_with_files(report_id: int) -> bool:
    """Delete a report from the database AND its OSS files."""
    report = find_report_by_id(report_id)
    if not report:
        return False

    deleted = delete_report_by_id(report_id)
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
    """If extracted into a single subfolder, use that as root."""
    children = [c for c in extraction_dir.iterdir() if c.is_dir()]
    if len(children) == 1:
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
