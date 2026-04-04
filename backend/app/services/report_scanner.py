import json
import re
from pathlib import Path
from typing import Any

from ..exceptions import AppError
from ..models import ReportMetadata

MANIFEST_FILENAMES = ("manifest.json", "report.json")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}


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


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AppError(f"{path.name} 不是合法 JSON: {exc.msg}", 400) from exc


def load_report_manifest(directory: Path) -> dict[str, Any] | None:
    for name in MANIFEST_FILENAMES:
        path = directory / name
        if path.exists():
            data = _read_json(path)
            if not isinstance(data, dict):
                raise AppError(f"{name} 顶层必须是 JSON object", 400)
            return data
    return None


def _resolve_package_path(directory: Path, relative_path: str, field_name: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise AppError(f"manifest.{field_name} 必须是非空字符串", 400)

    candidate = (directory / relative_path).resolve()
    base = directory.resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise AppError(f"manifest.{field_name} 不能越出报告目录", 400) from exc

    return candidate


def resolve_report_entry_html(directory: Path, manifest: dict[str, Any] | None = None) -> Path:
    manifest = manifest if manifest is not None else load_report_manifest(directory)
    if manifest:
        entry = manifest.get("entryHtml") or manifest.get("entry_html")
        path = _resolve_package_path(directory, entry, "entryHtml")
        if not path.exists():
            raise AppError(f"manifest.entryHtml 指向的文件不存在: {entry}", 400)
        return path
    path = directory / "index.html"
    if not path.exists():
        raise AppError("缺少必需文件 index.html", 400)
    return path


def resolve_report_overview_html(directory: Path, manifest: dict[str, Any] | None = None) -> Path | None:
    manifest = manifest if manifest is not None else load_report_manifest(directory)
    if manifest:
        overview = manifest.get("overviewHtml") or manifest.get("overview_html")
        if not overview:
            return None
        path = _resolve_package_path(directory, overview, "overviewHtml")
        if not path.exists():
            raise AppError(f"manifest.overviewHtml 指向的文件不存在: {overview}", 400)
        return path

    path = directory / "overview.html"
    return path if path.exists() else None


def _infer_look_count_from_files(directory: Path, excluded_paths: set[Path] | None = None) -> int:
    excluded = {path.resolve() for path in (excluded_paths or set())}
    return sum(
        1
        for f in directory.rglob("*")
        if f.is_file()
        and f.suffix.lower() in IMAGE_EXTENSIONS
        and f.resolve() not in excluded
    )


def _infer_look_count_from_features(directory: Path, manifest: dict[str, Any]) -> int | None:
    features_file = manifest.get("featuresFile") or manifest.get("features_file")
    if not features_file:
        return None

    path = _resolve_package_path(directory, features_file, "featuresFile")
    if not path.exists():
        raise AppError(f"manifest.featuresFile 指向的文件不存在: {features_file}", 400)

    payload = _read_json(path)
    if isinstance(payload, dict):
        return len(payload)
    if isinstance(payload, list):
        return len(payload)
    raise AppError("featuresFile 顶层必须是 object 或 array", 400)


def _resolve_required_cover_image(directory: Path, manifest: dict[str, Any] | None = None) -> Path:
    if manifest:
        cover = manifest.get("coverImage") or manifest.get("cover_image")
        if not cover:
            raise AppError("manifest 缺少必填字段 coverImage", 400)
        path = _resolve_package_path(directory, cover, "coverImage")
        if not path.exists():
            raise AppError(f"manifest.coverImage 指向的文件不存在: {cover}", 400)
        return path

    for name in ("cover.jpg", "cover.jpeg", "cover.png", "cover.webp"):
        for parent in (directory, directory / "assets", directory / "images"):
            candidate = parent / name
            if candidate.exists():
                return candidate

    raise AppError("缺少封面图：请在报告包中提供 cover.jpg 或 manifest.coverImage", 400)


def _infer_metadata_from_slug(slug: str) -> dict[str, Any]:
    parts = slug.split("-")
    if len(parts) < 3:
        raise AppError("目录名称不符合命名规范", 400)

    year_str = parts[-1]
    season = parts[-2]
    brand_parts = parts[:-2]

    try:
        year = int(year_str)
    except ValueError as exc:
        raise AppError("目录名称不符合命名规范", 400) from exc

    if not season or not brand_parts:
        raise AppError("目录名称不符合命名规范", 400)

    brand = " ".join(p.capitalize() for p in brand_parts)
    season_cap = season.capitalize()
    return {"brand": brand, "season": season_cap, "year": year}


def validate_report_directory(directory: Path) -> None:
    manifest = load_report_manifest(directory)
    if manifest:
        for field in ("slug", "brand", "season", "year", "entryHtml", "coverImage"):
            if manifest.get(field) in (None, ""):
                raise AppError(f"manifest 缺少必填字段 {field}", 400)

        resolve_report_entry_html(directory, manifest)
        resolve_report_overview_html(directory, manifest)
        _resolve_required_cover_image(directory, manifest)

        pages = manifest.get("pages")
        if pages is not None:
            if not isinstance(pages, list) or not all(isinstance(item, str) for item in pages):
                raise AppError("manifest.pages 必须是字符串数组", 400)
            for page in pages:
                page_path = _resolve_package_path(directory, page, "pages")
                if not page_path.exists():
                    raise AppError(f"manifest.pages 指向的文件不存在: {page}", 400)

        for field in ("featuresFile",):
            value = manifest.get(field)
            if value:
                path = _resolve_package_path(directory, value, field)
                if not path.exists():
                    raise AppError(f"manifest.{field} 指向的文件不存在: {value}", 400)
        return

    if not (directory / "index.html").exists():
        raise AppError("缺少必需文件 index.html", 400)
    _resolve_required_cover_image(directory, None)


def _extract_manifest_metadata(directory: Path, manifest: dict[str, Any]) -> ReportMetadata:
    validate_report_directory(directory)

    slug = _normalize_slug(str(manifest.get("slug", "")))
    if not slug:
        raise AppError("manifest.slug 无法转换为合法 slug", 400)

    entry_path = resolve_report_entry_html(directory, manifest)
    title = str(manifest.get("title", "")).strip()
    if not title:
        title = _infer_title(entry_path.read_text(encoding="utf-8")) or ""
    if not title:
        raise AppError("无法确定报告标题：请填写 manifest.title 或在 entryHtml 中提供 <title>", 400)

    brand = str(manifest.get("brand", "")).strip()
    season = str(manifest.get("season", "")).strip()
    if not brand or not season:
        raise AppError("manifest.brand 和 manifest.season 不能为空", 400)

    try:
        year = int(manifest.get("year"))
    except (TypeError, ValueError) as exc:
        raise AppError("manifest.year 必须是整数", 400) from exc

    look_count = manifest.get("lookCount")
    if look_count is not None:
        try:
            look_count = int(look_count)
        except (TypeError, ValueError) as exc:
            raise AppError("manifest.lookCount 必须是整数", 400) from exc
    else:
        look_count = _infer_look_count_from_features(directory, manifest)
        if look_count is None:
            cover_path = _resolve_required_cover_image(directory, manifest)
            look_count = _infer_look_count_from_files(directory, {cover_path})

    return ReportMetadata(
        slug=slug,
        title=title,
        brand=brand,
        season=season,
        year=year,
        look_count=look_count,
    )


def extract_report_metadata(directory: Path) -> ReportMetadata:
    manifest = load_report_manifest(directory)
    if manifest:
        return _extract_manifest_metadata(directory, manifest)

    validate_report_directory(directory)

    slug = _normalize_slug(directory.name)
    if not slug:
        raise AppError("无法生成合法 slug", 400)

    html = resolve_report_entry_html(directory).read_text(encoding="utf-8")
    title = _infer_title(html)
    if not title:
        raise AppError("无法从 index.html 提取标题", 400)

    meta = _infer_metadata_from_slug(slug)
    cover_path = _resolve_required_cover_image(directory)
    look_count = _infer_look_count_from_files(directory, {cover_path})

    return ReportMetadata(
        slug=slug,
        title=title,
        brand=meta["brand"],
        season=meta["season"],
        year=meta["year"],
        look_count=look_count,
    )
