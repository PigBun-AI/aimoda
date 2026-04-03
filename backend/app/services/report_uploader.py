"""
Report Uploader — Upload report files to OSS while preserving zip-relative paths.

Core flow:
  1. Read manifest / resolve entry HTML
  2. Upload every file except the manifest itself to OSS with the same relative path
  3. Use manifest.entryHtml (or legacy index.html) as the iframe entry URL
  4. Treat overview.html as optional
  5. Select and upload cover image when available
"""

from __future__ import annotations

import logging
import mimetypes
from dataclasses import dataclass, field
from pathlib import Path

from .oss_service import get_oss_service, OSSService
from .report_scanner import (
    MANIFEST_FILENAMES,
    load_report_manifest,
    resolve_report_entry_html,
    resolve_report_overview_html,
)

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}


@dataclass
class ReportOSSResult:
    """Result of uploading a report to OSS."""

    index_url: str
    overview_url: str | None = None
    cover_url: str | None = None
    oss_prefix: str = ""
    image_count: int = 0
    total_size_bytes: int = 0
    file_map: dict[str, str] = field(default_factory=dict)  # local_rel_path -> oss_url


def _scan_upload_files(report_root: Path) -> list[Path]:
    files: list[Path] = []
    for f in report_root.rglob("*"):
        if not f.is_file():
            continue
        if f.name in MANIFEST_FILENAMES:
            continue
        files.append(f)
    return sorted(files)


def _upload_files(oss: OSSService, report_root: Path, slug: str, files: list[Path]) -> dict[str, str]:
    path_map: dict[str, str] = {}
    for file_path in files:
        rel_path = file_path.relative_to(report_root)
        rel_str = rel_path.as_posix()
        oss_key = OSSService.report_path(slug, rel_str)
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"

        with open(file_path, "rb") as f:
            url = oss.upload_file(oss_key, f, content_type=content_type)

        path_map[rel_str] = url
        logger.debug("Uploaded %s -> %s", rel_str, url)

    return path_map


def _select_cover_image(report_root: Path, manifest: dict | None, uploaded_files: list[Path]) -> Path | None:
    if manifest:
        cover = manifest.get("coverImage") or manifest.get("cover_image")
        if isinstance(cover, str) and cover.strip():
            candidate = report_root / cover
            if candidate.exists():
                return candidate

    for name in ("cover.jpg", "cover.jpeg", "cover.png", "cover.webp"):
        for parent in (report_root, report_root / "assets", report_root / "images"):
            candidate = parent / name
            if candidate.exists():
                return candidate

    images = [f for f in uploaded_files if f.suffix.lower() in IMAGE_EXTENSIONS]
    return images[0] if images else None


def upload_report_to_oss(report_root: Path, slug: str) -> ReportOSSResult:
    """Upload all report files to OSS and return URLs."""

    oss = get_oss_service()
    oss_prefix = f"reports/{slug}/"
    manifest = load_report_manifest(report_root)

    upload_files = _scan_upload_files(report_root)
    path_map = _upload_files(oss, report_root, slug, upload_files)
    total_size = sum(file_path.stat().st_size for file_path in upload_files)
    image_count = sum(1 for file_path in upload_files if file_path.suffix.lower() in IMAGE_EXTENSIONS)

    entry_path = resolve_report_entry_html(report_root, manifest)
    entry_rel = entry_path.relative_to(report_root).as_posix()
    index_url = path_map[entry_rel]

    overview_path = resolve_report_overview_html(report_root, manifest)
    overview_url = None
    if overview_path is not None:
        overview_rel = overview_path.relative_to(report_root).as_posix()
        overview_url = path_map.get(overview_rel)

    cover_url = None
    cover_img = _select_cover_image(report_root, manifest, upload_files)
    if cover_img is not None:
        cover_rel = cover_img.relative_to(report_root).as_posix()
        cover_url = path_map.get(cover_rel)

    logger.info(
        "Uploaded %d files (%d images) for report %s (%.1f MB)",
        len(upload_files),
        image_count,
        slug,
        total_size / 1024 / 1024,
    )

    return ReportOSSResult(
        index_url=index_url,
        overview_url=overview_url,
        cover_url=cover_url,
        oss_prefix=oss_prefix,
        image_count=image_count,
        total_size_bytes=total_size,
        file_map=path_map,
    )
