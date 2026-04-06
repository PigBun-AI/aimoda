from dataclasses import dataclass
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from ..models import ReportMetadata
from .report_package_errors import ReportPackageError

MANIFEST_FILENAMES = ("manifest.json", "report.json")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
HTML_REF_ATTR_PATTERN = re.compile(r'(?P<prefix>\b(?:src|href)=["\'])(?P<url>[^"\']+)(?P<suffix>["\'])', re.IGNORECASE)
HTML_IMG_SRC_PATTERN = re.compile(r'<img\b[^>]*\bsrc=["\'](?P<url>[^"\']+)["\']', re.IGNORECASE)
EXTERNAL_URL_PREFIXES = ("http://", "https://", "//", "mailto:", "tel:", "javascript:", "#", "?")
WINDOWS_ABSOLUTE_PATH_PATTERN = re.compile(r"^[a-zA-Z]:[\\/]")
MAX_INLINE_IMAGE_URI_LENGTH = 8 * 1024


@dataclass(frozen=True)
class ResolvedCoverImage:
    path: Path
    source: str


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
        raise ReportPackageError("invalid_manifest_json", f"{path.name} 不是合法 JSON: {exc.msg}") from exc


def load_report_manifest(directory: Path) -> dict[str, Any] | None:
    for name in MANIFEST_FILENAMES:
        path = directory / name
        if path.exists():
            data = _read_json(path)
            if not isinstance(data, dict):
                raise ReportPackageError("invalid_manifest_format", f"{name} 顶层必须是 JSON object")
            return data
    return None


def _resolve_package_path(directory: Path, relative_path: str, field_name: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise ReportPackageError(
            "invalid_manifest_path",
            f"manifest.{field_name} 必须是非空字符串",
            details={"field": field_name},
        )

    candidate = (directory / relative_path).resolve()
    base = directory.resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise ReportPackageError(
            "path_traversal_not_allowed",
            f"manifest.{field_name} 不能越出报告目录",
            details={"field": field_name, "path": relative_path},
        ) from exc

    return candidate


def resolve_report_entry_html(directory: Path, manifest: dict[str, Any] | None = None) -> Path:
    manifest = manifest if manifest is not None else load_report_manifest(directory)
    if manifest:
        entry = manifest.get("entryHtml") or manifest.get("entry_html")
        path = _resolve_package_path(directory, entry, "entryHtml")
        if not path.exists():
            raise ReportPackageError(
                "entry_html_not_found",
                f"manifest.entryHtml 指向的文件不存在: {entry}",
                details={"path": entry},
            )
        return path
    path = directory / "index.html"
    if not path.exists():
        raise ReportPackageError("legacy_index_html_missing", "缺少必需文件 index.html")
    return path


def resolve_report_overview_html(directory: Path, manifest: dict[str, Any] | None = None) -> Path | None:
    manifest = manifest if manifest is not None else load_report_manifest(directory)
    if manifest:
        overview = manifest.get("overviewHtml") or manifest.get("overview_html")
        if not overview:
            return None
        path = _resolve_package_path(directory, overview, "overviewHtml")
        if not path.exists():
            raise ReportPackageError(
                "overview_html_not_found",
                f"manifest.overviewHtml 指向的文件不存在: {overview}",
                details={"path": overview},
            )
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
        raise ReportPackageError(
            "features_file_not_found",
            f"manifest.featuresFile 指向的文件不存在: {features_file}",
            details={"path": features_file},
        )

    payload = _read_json(path)
    if isinstance(payload, dict):
        return len(payload)
    if isinstance(payload, list):
        return len(payload)
    raise ReportPackageError("invalid_features_file", "featuresFile 顶层必须是 object 或 array")


def _iter_html_paths(directory: Path) -> list[Path]:
    return sorted(path for path in directory.rglob("*.html") if path.is_file())


def _is_external_like_url(raw_url: str) -> bool:
    normalized = raw_url.strip().lower()
    return normalized.startswith(EXTERNAL_URL_PREFIXES)


def _resolve_html_reference(report_root: Path, html_path: Path, raw_url: str) -> Path | None:
    parsed = urlsplit(raw_url)
    rel_path = parsed.path.strip()
    if not rel_path:
        return None
    if WINDOWS_ABSOLUTE_PATH_PATTERN.match(rel_path) or rel_path.startswith("/"):
        raise ReportPackageError(
            "absolute_local_path_not_allowed",
            f"HTML 中存在不允许的绝对本地路径: {raw_url}",
            details={"html": html_path.relative_to(report_root).as_posix(), "url": raw_url},
        )
    target = (html_path.parent / rel_path).resolve()
    base = report_root.resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise ReportPackageError(
            "path_traversal_not_allowed",
            f"HTML 资源路径不能越出报告目录: {raw_url}",
            details={"html": html_path.relative_to(report_root).as_posix(), "url": raw_url},
        ) from exc
    return target


def _validate_html_references(report_root: Path, html_path: Path) -> None:
    html = html_path.read_text(encoding="utf-8")
    html_rel = html_path.relative_to(report_root).as_posix()
    for match in HTML_REF_ATTR_PATTERN.finditer(html):
        raw_url = match.group("url").strip()
        if not raw_url:
            continue
        lowered = raw_url.lower()
        if lowered.startswith("data:image/"):
            if len(raw_url) > MAX_INLINE_IMAGE_URI_LENGTH:
                raise ReportPackageError(
                    "inline_image_too_large",
                    "HTML 中存在过大的内嵌 base64 图片，请将正文图片改为 ZIP 内独立资源文件。",
                    details={"html": html_rel},
                )
            continue
        if lowered.startswith("file:"):
            raise ReportPackageError(
                "absolute_local_path_not_allowed",
                f"HTML 中存在不允许的 file:// 本地路径: {raw_url}",
                details={"html": html_rel, "url": raw_url},
            )
        if _is_external_like_url(raw_url):
            continue

        target = _resolve_html_reference(report_root, html_path, raw_url)
        if target is None:
            continue
        if not target.exists():
            root_target = (report_root / urlsplit(raw_url).path.strip()).resolve()
            try:
                root_target.relative_to(report_root.resolve())
            except ValueError:
                root_target = None
            if (
                root_target is not None
                and root_target.exists()
                and not urlsplit(raw_url).path.strip().startswith("../")
            ):
                continue
            raise ReportPackageError(
                "linked_file_not_found",
                f"HTML 引用的本地文件不存在: {raw_url}",
                details={"html": html_rel, "url": raw_url},
            )


def _find_first_entry_image(report_root: Path, entry_path: Path) -> Path | None:
    html = entry_path.read_text(encoding="utf-8")
    for match in HTML_IMG_SRC_PATTERN.finditer(html):
        raw_url = match.group("url").strip()
        if not raw_url or raw_url.lower().startswith("data:image/") or _is_external_like_url(raw_url):
            continue
        candidate = _resolve_html_reference(report_root, entry_path, raw_url)
        if candidate and candidate.exists() and candidate.suffix.lower() in IMAGE_EXTENSIONS:
            return candidate
    return None


def resolve_report_cover_image(directory: Path, manifest: dict[str, Any] | None = None) -> ResolvedCoverImage | None:
    if manifest:
        cover = manifest.get("coverImage") or manifest.get("cover_image")
        if not cover:
            cover = None
        if cover:
            path = _resolve_package_path(directory, cover, "coverImage")
            if not path.exists():
                raise ReportPackageError(
                    "cover_image_not_found",
                    f"manifest.coverImage 指向的文件不存在: {cover}",
                    details={"path": cover},
                )
            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                raise ReportPackageError(
                    "invalid_cover_image",
                    "manifest.coverImage 必须指向图片文件",
                    details={"path": cover},
                )
            return ResolvedCoverImage(path=path, source="manifest")

    for name in ("cover.jpg", "cover.jpeg", "cover.png", "cover.webp"):
        for parent in (directory, directory / "assets", directory / "images"):
            candidate = parent / name
            if candidate.exists():
                return ResolvedCoverImage(path=candidate, source="legacy")

    entry_path = resolve_report_entry_html(directory, manifest)
    first_image = _find_first_entry_image(directory, entry_path)
    if first_image is not None:
        return ResolvedCoverImage(path=first_image, source="entry_html")

    return None


def _resolve_required_cover_image(directory: Path, manifest: dict[str, Any] | None = None) -> ResolvedCoverImage:
    resolved = resolve_report_cover_image(directory, manifest)
    if resolved is not None:
        return resolved

    if manifest:
        raise ReportPackageError(
            "cover_image_not_found",
            "无法自动生成封面：请在 entryHtml 首屏提供至少一张本地图片，或显式提供 manifest.coverImage。",
        )

    raise ReportPackageError("cover_image_not_found", "缺少封面图：请提供 cover.jpg 或让 index.html 首屏包含本地图片。")


def _infer_metadata_from_slug(slug: str) -> dict[str, Any]:
    parts = slug.split("-")
    if len(parts) < 3:
        raise ReportPackageError("invalid_legacy_slug", "目录名称不符合命名规范")

    year_str = parts[-1]
    season = parts[-2]
    brand_parts = parts[:-2]

    try:
        year = int(year_str)
    except ValueError as exc:
        raise ReportPackageError("invalid_legacy_slug", "目录名称不符合命名规范") from exc

    if not season or not brand_parts:
        raise ReportPackageError("invalid_legacy_slug", "目录名称不符合命名规范")

    brand = " ".join(p.capitalize() for p in brand_parts)
    season_cap = season.capitalize()
    return {"brand": brand, "season": season_cap, "year": year}


def _validate_all_html_files(directory: Path) -> None:
    html_files = _iter_html_paths(directory)
    for html_path in html_files:
        _validate_html_references(directory, html_path)


def _cover_paths_to_exclude(cover: ResolvedCoverImage | None) -> set[Path]:
    if cover is None:
        return set()
    if cover.source == "legacy":
        return {cover.path.resolve()}
    if cover.source == "manifest" and cover.path.name.lower().startswith("cover."):
        return {cover.path.resolve()}
    return set()


def validate_report_directory(directory: Path) -> None:
    manifest = load_report_manifest(directory)
    if manifest:
        for field in ("slug", "brand", "season", "year", "entryHtml"):
            if manifest.get(field) in (None, ""):
                raise ReportPackageError(
                    "missing_manifest_field",
                    f"manifest 缺少必填字段 {field}",
                    details={"field": field},
                )

        resolve_report_entry_html(directory, manifest)
        resolve_report_overview_html(directory, manifest)
        _validate_all_html_files(directory)
        _resolve_required_cover_image(directory, manifest)

        pages = manifest.get("pages")
        if pages is not None:
            if not isinstance(pages, list) or not all(isinstance(item, str) for item in pages):
                raise ReportPackageError("invalid_manifest_pages", "manifest.pages 必须是字符串数组")
            for page in pages:
                page_path = _resolve_package_path(directory, page, "pages")
                if not page_path.exists():
                    raise ReportPackageError(
                        "linked_file_not_found",
                        f"manifest.pages 指向的文件不存在: {page}",
                        details={"path": page},
                    )

        for field in ("featuresFile",):
            value = manifest.get(field)
            if value:
                path = _resolve_package_path(directory, value, field)
                if not path.exists():
                    raise ReportPackageError(
                        "linked_file_not_found",
                        f"manifest.{field} 指向的文件不存在: {value}",
                        details={"path": value},
                    )
        return

    if not (directory / "index.html").exists():
        raise ReportPackageError("legacy_index_html_missing", "缺少必需文件 index.html")
    _validate_all_html_files(directory)
    _resolve_required_cover_image(directory, None)


def _extract_manifest_metadata(directory: Path, manifest: dict[str, Any]) -> ReportMetadata:
    validate_report_directory(directory)

    slug = _normalize_slug(str(manifest.get("slug", "")))
    if not slug:
        raise ReportPackageError("invalid_slug", "manifest.slug 无法转换为合法 slug")

    entry_path = resolve_report_entry_html(directory, manifest)
    title = str(manifest.get("title", "")).strip()
    if not title:
        title = _infer_title(entry_path.read_text(encoding="utf-8")) or ""
    if not title:
        raise ReportPackageError(
            "title_not_found",
            "无法确定报告标题：请填写 manifest.title 或在 entryHtml 中提供 <title>",
        )

    brand = str(manifest.get("brand", "")).strip()
    season = str(manifest.get("season", "")).strip()
    if not brand or not season:
        raise ReportPackageError("missing_manifest_field", "manifest.brand 和 manifest.season 不能为空")

    try:
        year = int(manifest.get("year"))
    except (TypeError, ValueError) as exc:
        raise ReportPackageError("invalid_manifest_year", "manifest.year 必须是整数") from exc

    look_count = manifest.get("lookCount")
    if look_count is not None:
        try:
            look_count = int(look_count)
        except (TypeError, ValueError) as exc:
            raise ReportPackageError("invalid_manifest_look_count", "manifest.lookCount 必须是整数") from exc
    else:
        look_count = _infer_look_count_from_features(directory, manifest)
        if look_count is None:
            cover = _resolve_required_cover_image(directory, manifest)
            look_count = _infer_look_count_from_files(directory, _cover_paths_to_exclude(cover))

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
        raise ReportPackageError("invalid_slug", "无法生成合法 slug")

    html = resolve_report_entry_html(directory).read_text(encoding="utf-8")
    title = _infer_title(html)
    if not title:
        raise ReportPackageError("title_not_found", "无法从 index.html 提取标题")

    meta = _infer_metadata_from_slug(slug)
    cover = _resolve_required_cover_image(directory)
    look_count = _infer_look_count_from_files(directory, _cover_paths_to_exclude(cover))

    return ReportMetadata(
        slug=slug,
        title=title,
        brand=meta["brand"],
        season=meta["season"],
        year=meta["year"],
        look_count=look_count,
    )
