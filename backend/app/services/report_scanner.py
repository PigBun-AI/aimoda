import re
from pathlib import Path

from ..constants import REPORT_SPEC
from ..exceptions import AppError
from ..models import ReportMetadata


def _strip_tags(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", value)).strip()


def _normalize_slug(name: str) -> str:
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug


def _infer_title(html: str) -> str | None:
    title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    heading_match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
    candidate = (title_match.group(1) if title_match else None) or (
        heading_match.group(1) if heading_match else None
    )
    return _strip_tags(candidate) if candidate else None


def _infer_look_count(images_dir: Path) -> int:
    if not images_dir.is_dir():
        return 0
    return sum(
        1
        for f in images_dir.iterdir()
        if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )


def _infer_metadata_from_slug(slug: str) -> dict:
    parts = slug.split("-")
    if len(parts) < 3:
        raise AppError("目录名称不符合命名规范", 400)

    year_str = parts[-1]
    season = parts[-2]
    brand_parts = parts[:-2]

    try:
        year = int(year_str)
    except ValueError:
        raise AppError("目录名称不符合命名规范", 400)

    if not season or not brand_parts:
        raise AppError("目录名称不符合命名规范", 400)

    brand = " ".join(p.capitalize() for p in brand_parts)
    season_cap = season.capitalize()

    return {"brand": brand, "season": season_cap, "year": year}


def validate_report_directory(directory: Path) -> None:
    required = REPORT_SPEC["folderStructure"]["required"]
    for entry in required:
        entry_path = directory / entry
        if not entry_path.exists():
            raise AppError(f"缺少必需文件 {entry}", 400)


def extract_report_metadata(directory: Path) -> ReportMetadata:
    validate_report_directory(directory)

    slug = _normalize_slug(directory.name)
    if not slug:
        raise AppError("无法生成合法 slug", 400)

    html = (directory / "index.html").read_text(encoding="utf-8")
    title = _infer_title(html)
    if not title:
        raise AppError("无法从 index.html 提取标题", 400)

    meta = _infer_metadata_from_slug(slug)
    images_dir = directory / "images"
    look_count = _infer_look_count(images_dir)

    return ReportMetadata(
        slug=slug,
        title=title,
        brand=meta["brand"],
        season=meta["season"],
        year=meta["year"],
        look_count=look_count,
    )
