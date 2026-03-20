import json
import shutil
import tempfile
import zipfile
from pathlib import Path

from ..config import settings
from ..constants import REPORT_SPEC
from ..database import get_db
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


def get_report_spec() -> dict:
    return REPORT_SPEC


def get_report(report_id: int) -> ReportRecord | None:
    return find_report_by_id(report_id)


def get_reports(page: int = 1, limit: int = 12) -> tuple[list[ReportRecord], int]:
    return list_reports(page, limit)


def delete_report_with_files(report_id: int) -> bool:
    report = find_report_by_id(report_id)
    if not report:
        return False

    deleted = delete_report_by_id(report_id)
    if deleted and report.path:
        report_path = Path(report.path)
        if report_path.exists():
            shutil.rmtree(report_path, ignore_errors=True)
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
    reports_dir = settings.resolved_reports_dir
    upload_tmp_dir = settings.resolved_upload_tmp_dir

    reports_dir.mkdir(parents=True, exist_ok=True)
    upload_tmp_dir.mkdir(parents=True, exist_ok=True)

    extraction_dir = Path(tempfile.mkdtemp(prefix="report-", dir=str(upload_tmp_dir)))
    destination_path: Path | None = None

    try:
        _extract_archive(Path(archive_path), extraction_dir)
        report_root = _resolve_report_root(extraction_dir)
        metadata = extract_report_metadata(report_root)

        destination_path = reports_dir / metadata.slug

        if destination_path.exists():
            raise AppError(f"报告目录已存在: {metadata.slug}", 409)

        shutil.copytree(report_root, destination_path)

        # Atomic check + insert using transaction
        db = get_db()
        existing = find_report_by_slug(metadata.slug)
        if existing:
            raise AppError(f"报告 slug 已存在: {metadata.slug}", 409)

        report = create_report(
            slug=metadata.slug,
            title=metadata.title,
            brand=metadata.brand,
            season=metadata.season,
            year=metadata.year,
            look_count=metadata.look_count,
            path=str(destination_path),
            uploaded_by=uploaded_by,
            metadata_json=json.dumps(metadata.model_dump()),
        )

        return report

    except Exception:
        # Rollback: clean up destination if created
        if destination_path and destination_path.exists():
            shutil.rmtree(destination_path, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(extraction_dir, ignore_errors=True)
        archive = Path(archive_path)
        if archive.exists():
            archive.unlink(missing_ok=True)
