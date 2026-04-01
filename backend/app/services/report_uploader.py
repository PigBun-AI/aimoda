"""
Report Uploader — Upload report assets to OSS with HTML link replacement.

Core flow:
  1. Scan images/ directory in the extracted report
  2. Upload each image to OSS at reports/{slug}/images/{filename}
  3. Read index.html, replace all image references with OSS URLs
  4. Upload modified index.html to OSS
  5. Same for overview.html (if exists)
  6. Upload/generate cover image
  7. Return all URLs
"""

from __future__ import annotations

import logging
import mimetypes
import re
from dataclasses import dataclass, field
from pathlib import Path

from .oss_service import get_oss_service, OSSService

logger = logging.getLogger(__name__)

# Image extensions we upload
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
    image_map: dict[str, str] = field(default_factory=dict)  # local_rel_path -> oss_url


def _scan_images(report_root: Path) -> list[Path]:
    """Find all image files recursively in the report directory."""
    images = []
    for f in report_root.rglob("*"):
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS:
            images.append(f)
    return sorted(images)


def _upload_images(
    oss: OSSService,
    report_root: Path,
    slug: str,
    images: list[Path],
) -> dict[str, str]:
    """Upload images to OSS. Returns {relative_path: oss_url}."""
    path_map: dict[str, str] = {}
    for img_path in images:
        rel_path = img_path.relative_to(report_root)
        oss_key = OSSService.report_path(slug, str(rel_path))
        content_type = mimetypes.guess_type(str(img_path))[0] or "application/octet-stream"

        with open(img_path, "rb") as f:
            url = oss.upload_file(oss_key, f, content_type=content_type)

        # Map multiple forms of the relative path for robust replacement
        # e.g. "images/look-01.jpg", "./images/look-01.jpg"
        rel_str = str(rel_path)
        path_map[rel_str] = url
        path_map[f"./{rel_str}"] = url

        logger.debug("Uploaded %s -> %s", rel_str, url)

    return path_map


def _replace_paths_in_html(html: str, path_map: dict[str, str]) -> str:
    """Replace local image references in HTML with OSS URLs.

    Handles:
    - <img src="images/xxx.jpg">
    - <img src="./images/xxx.jpg">
    - background-image: url(images/xxx.jpg)
    - background-image: url('./images/xxx.jpg')
    - background: url("images/xxx.jpg")
    - CSS in <style> blocks and inline styles
    """
    result = html

    # Sort by longest path first to avoid partial replacements
    sorted_paths = sorted(path_map.keys(), key=len, reverse=True)

    for local_path, oss_url in ((p, path_map[p]) for p in sorted_paths):
        # Escape special regex chars in path
        escaped = re.escape(local_path)

        # Replace in HTML attributes: src="...", href="..."
        # Matches: src="images/look.jpg" or src='images/look.jpg'
        result = re.sub(
            rf'((?:src|href|poster|data-src)\s*=\s*["\'])({escaped})(["\'])',
            rf'\1{oss_url}\3',
            result,
        )

        # Replace in CSS url(): url(images/look.jpg), url('...'), url("...")
        result = re.sub(
            rf'(url\s*\(\s*["\']?)({escaped})(["\']?\s*\))',
            rf'\1{oss_url}\3',
            result,
        )

    return result


def _select_cover_image(report_root: Path, images: list[Path]) -> Path | None:
    """Select the best candidate for cover image.

    Priority:
    1. cover.jpg / cover.png / cover.webp in root or images/
    2. First image alphabetically
    """
    for name in ("cover.jpg", "cover.png", "cover.webp"):
        for parent in (report_root, report_root / "images"):
            candidate = parent / name
            if candidate.exists():
                return candidate

    return images[0] if images else None


def upload_report_to_oss(report_root: Path, slug: str) -> ReportOSSResult:
    """Upload all report assets to OSS and return URLs.

    Args:
        report_root: Path to extracted report directory (contains index.html, images/, etc.)
        slug: Report slug for OSS path, e.g. "zimmermann-fall-2026"

    Returns:
        ReportOSSResult with all OSS URLs
    """
    oss = get_oss_service()
    oss_prefix = f"reports/{slug}/"

    # 1. Scan and upload images
    images = _scan_images(report_root)
    path_map = _upload_images(oss, report_root, slug, images)
    total_size = sum(img.stat().st_size for img in images)

    logger.info("Uploaded %d images for report %s (%.1f MB)",
                len(images), slug, total_size / 1024 / 1024)

    # 2. Process and upload index.html
    index_path = report_root / "index.html"
    index_html = index_path.read_text(encoding="utf-8")
    modified_html = _replace_paths_in_html(index_html, path_map)

    index_oss_key = OSSService.report_path(slug, "index.html")
    index_url = oss.upload_file(
        index_oss_key,
        modified_html.encode("utf-8"),
        content_type="text/html; charset=utf-8",
    )

    # 3. Process and upload overview.html (optional)
    overview_url = None
    overview_path = report_root / "overview.html"
    if overview_path.exists():
        overview_html = overview_path.read_text(encoding="utf-8")
        modified_overview = _replace_paths_in_html(overview_html, path_map)
        overview_oss_key = OSSService.report_path(slug, "overview.html")
        overview_url = oss.upload_file(
            overview_oss_key,
            modified_overview.encode("utf-8"),
            content_type="text/html; charset=utf-8",
        )

    # 4. Upload cover image
    cover_url = None
    cover_img = _select_cover_image(report_root, images)
    if cover_img:
        cover_oss_key = OSSService.report_path(slug, "cover" + cover_img.suffix.lower())
        cover_type = mimetypes.guess_type(str(cover_img))[0] or "image/jpeg"
        with open(cover_img, "rb") as f:
            cover_url = oss.upload_file(cover_oss_key, f, content_type=cover_type)

    return ReportOSSResult(
        index_url=index_url,
        overview_url=overview_url,
        cover_url=cover_url,
        oss_prefix=oss_prefix,
        image_count=len(images),
        total_size_bytes=total_size,
        image_map=path_map,
    )
