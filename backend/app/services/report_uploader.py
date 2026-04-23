"""
Report Uploader — Upload report files to OSS while preserving zip-relative paths.

Core flow:
  1. Read manifest / resolve entry HTML
  2. Upload every file except the manifest itself to OSS with the same relative path
  3. Use manifest.entryHtml (or legacy index.html) as the iframe entry URL
  4. Treat overview.html as optional
  5. Resolve list cover from explicit cover image or the first local image in entry HTML
"""

from __future__ import annotations

import logging
import mimetypes
import os
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from .oss_service import get_oss_service, OSSService
from .report_scanner import (
    MANIFEST_FILENAMES,
    load_report_manifest,
    resolve_report_cover_image,
    resolve_report_entry_html,
    resolve_report_overview_html,
    validate_report_directory,
)

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}
HTML_REF_ATTR_PATTERN = re.compile(r'(?P<prefix>\b(?:src|href)=["\'])(?P<url>[^"\']+)(?P<suffix>["\'])', re.IGNORECASE)
EXTERNAL_URL_PREFIXES = ("http://", "https://", "//", "data:", "mailto:", "tel:", "javascript:", "#", "?")


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


def _normalize_html_asset_paths(report_root: Path) -> None:
    """Rewrite broken root-relative-ish HTML asset refs to valid relative paths.

    Some report packages place the entry HTML under `pages/` but reference sibling
    top-level assets as `assets/foo.jpg`. Browsers resolve that to
    `pages/assets/foo.jpg`, which breaks. We only rewrite refs when:
      1. the current relative target does not exist, and
      2. the same path exists from the report root.
    """

    for html_path in report_root.rglob("*.html"):
        original = html_path.read_text(encoding="utf-8")
        parent_dir = html_path.parent
        changed = False

        def _replace(match: re.Match[str]) -> str:
            nonlocal changed
            raw_url = match.group("url").strip()
            if not raw_url or raw_url.startswith(EXTERNAL_URL_PREFIXES):
                return match.group(0)

            parsed = urlsplit(raw_url)
            rel_path = parsed.path.strip()
            if not rel_path or rel_path.startswith("../"):
                return match.group(0)

            current_target = parent_dir / rel_path
            if current_target.exists():
                return match.group(0)

            root_target = report_root / rel_path
            if not root_target.exists():
                return match.group(0)

            rewritten = PurePosixPath(os.path.relpath(root_target, start=parent_dir)).as_posix()
            rebuilt_url = urlunsplit(("", "", rewritten, parsed.query, parsed.fragment))
            changed = True
            return f"{match.group('prefix')}{rebuilt_url}{match.group('suffix')}"

        normalized = HTML_REF_ATTR_PATTERN.sub(_replace, original)
        if changed and normalized != original:
            html_path.write_text(normalized, encoding="utf-8")
            logger.info("Normalized broken asset refs in %s", html_path.relative_to(report_root).as_posix())


def _upload_files(oss: OSSService, report_root: Path, slug: str, files: list[Path], *, namespace: str) -> dict[str, str]:
    path_map: dict[str, str] = {}
    for file_path in files:
        rel_path = file_path.relative_to(report_root)
        rel_str = rel_path.as_posix()
        oss_key = f"{namespace}/{slug}/{rel_str}"
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"

        with open(file_path, "rb") as f:
            url = oss.upload_file(oss_key, f, content_type=content_type)

        path_map[rel_str] = url
        logger.debug("Uploaded %s -> %s", rel_str, url)

    return path_map


def upload_report_to_oss(
    report_root: Path,
    slug: str,
    *,
    namespace: str = "reports",
    validate_manifest: bool = True,
) -> ReportOSSResult:
    """Upload all report files to OSS and return URLs."""

    oss = get_oss_service()
    oss_prefix = f"{namespace}/{slug}/"
    manifest = load_report_manifest(report_root)
    if validate_manifest:
        validate_report_directory(report_root)
    _normalize_html_asset_paths(report_root)

    upload_files = _scan_upload_files(report_root)
    path_map = _upload_files(oss, report_root, slug, upload_files, namespace=namespace)
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
    cover_image = resolve_report_cover_image(report_root, manifest)
    if cover_image is not None:
        cover_rel = cover_image.path.relative_to(report_root).as_posix()
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
