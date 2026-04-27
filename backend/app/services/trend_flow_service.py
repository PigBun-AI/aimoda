from __future__ import annotations

import logging
import posixpath
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from ..config import settings
from ..constants import TREND_FLOW_SPEC, TREND_FLOW_TEMPLATE
from ..exceptions import AppError
from ..models import TrendFlowRecord
from ..repositories.trend_flow_repo import (
    create_trend_flow,
    delete_trend_flow,
    find_trend_flow_by_id,
    find_trend_flow_by_slug,
    list_trend_flows,
    update_trend_flow_admin_fields,
)
from .oss_service import get_oss_service
from .report_uploader import upload_report_to_oss
from .trend_flow_package_compiler import compile_trend_flow_package
from .trend_flow_scanner import parse_trend_flow_metadata_json

logger = logging.getLogger(__name__)

TREND_FLOW_COVER_HTML_URL_ATTR_PATTERN = re.compile(
    r'(?P<prefix>\b(?:src|href|poster|data-src|data-original|data-full|data-image)=["\'])'
    r'(?P<url>[^"\']+)'
    r'(?P<suffix>["\'])',
    re.IGNORECASE,
)
TREND_FLOW_COVER_HTML_SRCSET_PATTERN = re.compile(
    r'(?P<prefix>\bsrcset=["\'])'
    r'(?P<value>[^"\']+)'
    r'(?P<suffix>["\'])',
    re.IGNORECASE,
)
TREND_FLOW_COVER_CSS_URL_PATTERN = re.compile(
    r'url\((?P<quote>["\']?)(?P<url>[^)"\']+)(?P=quote)\)',
    re.IGNORECASE,
)
TREND_FLOW_COVER_EXTERNAL_URL_PREFIXES = (
    "http://",
    "https://",
    "//",
    "data:",
    "mailto:",
    "tel:",
    "javascript:",
    "#",
)


def get_trend_flow_spec() -> dict:
    return TREND_FLOW_SPEC


def get_trend_flow_template() -> dict:
    return TREND_FLOW_TEMPLATE


def get_trend_flow(trend_flow_id: int) -> TrendFlowRecord | None:
    return find_trend_flow_by_id(trend_flow_id)


def get_trend_flows(page: int = 1, limit: int = 12, q: str | None = None) -> tuple[list[TrendFlowRecord], int]:
    return list_trend_flows(page=page, limit=limit, q=q)


def _parse_timeline_payload(trend_flow: TrendFlowRecord) -> list[dict]:
    metadata = parse_trend_flow_metadata_json(trend_flow.metadata_json)
    timeline = metadata.get("timeline")
    if isinstance(timeline, list):
        return [item for item in timeline if isinstance(item, dict)]

    timeline = parse_trend_flow_metadata_json(trend_flow.timeline_json).get("items")
    if isinstance(timeline, list):
        return [item for item in timeline if isinstance(item, dict)]

    raw_timeline = trend_flow.timeline_json
    if raw_timeline:
        try:
            import json

            payload = json.loads(raw_timeline)
            if isinstance(payload, list):
                return [item for item in payload if isinstance(item, dict)]
        except Exception:
            return []
    return []


def _build_window_label(trend_flow: TrendFlowRecord) -> str:
    return f"{trend_flow.start_year} {trend_flow.start_quarter} → {trend_flow.end_year} {trend_flow.end_quarter}"


def _resolve_trend_flow_entry_path(trend_flow: TrendFlowRecord, metadata: dict | None = None) -> str:
    payload = metadata or parse_trend_flow_metadata_json(trend_flow.metadata_json)
    entry_html = payload.get("entryHtml") or payload.get("entry_html")
    if isinstance(entry_html, str) and entry_html.strip():
        return entry_html.strip().lstrip("/")

    parsed = urlsplit(trend_flow.index_url or "")
    candidate_path = unquote(parsed.path)
    marker = f"/trend-flow/{trend_flow.slug}/"
    if marker in candidate_path:
        return candidate_path.split(marker, 1)[1].lstrip("/")
    return "index.html"


def _resolve_cover_asset_ref_path(current_asset_path: str, raw_url: str) -> str | None:
    candidate = (raw_url or "").strip()
    lowered = candidate.lower()
    if not candidate or lowered.startswith(TREND_FLOW_COVER_EXTERNAL_URL_PREFIXES) or candidate.startswith("?"):
        return None

    parsed = urlsplit(candidate)
    if not parsed.path:
        return None

    base_dir = posixpath.dirname(current_asset_path)
    joined = posixpath.normpath(posixpath.join(base_dir, parsed.path))
    if not joined or joined in {".", ".."} or joined.startswith("../") or "/../" in f"/{joined}":
        return None
    return joined.lstrip("/")


def _build_preview_asset_url(trend_flow_id: int, normalized_path: str) -> str:
    return f"/api/trend-flow/{trend_flow_id}/preview/{quote(normalized_path, safe='/')}"


def _rewrite_trend_flow_cover_html_refs(cover_html: str, trend_flow_id: int, current_asset_path: str) -> str:
    def _replace_attr(match: re.Match[str]) -> str:
        resolved = _resolve_cover_asset_ref_path(current_asset_path, match.group("url"))
        if not resolved:
            return match.group(0)
        return f"{match.group('prefix')}{_build_preview_asset_url(trend_flow_id, resolved)}{match.group('suffix')}"

    def _replace_srcset(match: re.Match[str]) -> str:
        rewritten_items: list[str] = []
        changed = False
        for item in match.group("value").split(","):
            token = item.strip()
            if not token:
                continue
            parts = token.split()
            resolved = _resolve_cover_asset_ref_path(current_asset_path, parts[0])
            if resolved:
                parts[0] = _build_preview_asset_url(trend_flow_id, resolved)
                changed = True
            rewritten_items.append(" ".join(parts))

        if not changed:
            return match.group(0)
        return f"{match.group('prefix')}{', '.join(rewritten_items)}{match.group('suffix')}"

    def _replace_css_url(match: re.Match[str]) -> str:
        resolved = _resolve_cover_asset_ref_path(current_asset_path, match.group("url"))
        if not resolved:
            return match.group(0)
        quote_char = match.group("quote") or ""
        return f"url({quote_char}{_build_preview_asset_url(trend_flow_id, resolved)}{quote_char})"

    rewritten = TREND_FLOW_COVER_HTML_URL_ATTR_PATTERN.sub(_replace_attr, cover_html)
    rewritten = TREND_FLOW_COVER_HTML_SRCSET_PATTERN.sub(_replace_srcset, rewritten)
    return TREND_FLOW_COVER_CSS_URL_PATTERN.sub(_replace_css_url, rewritten)


def _resolve_trend_flow_cover_html(trend_flow: TrendFlowRecord, metadata: dict) -> str | None:
    cover_html = metadata.get("coverHtml") or metadata.get("cover_html")
    if not isinstance(cover_html, str) or not cover_html.strip():
        return None

    cover_asset_path = metadata.get("coverHtmlAssetPath") or metadata.get("cover_html_asset_path")
    if not isinstance(cover_asset_path, str) or not cover_asset_path.strip():
        cover_asset_path = _resolve_trend_flow_entry_path(trend_flow, metadata)

    return _rewrite_trend_flow_cover_html_refs(
        cover_html.strip(),
        trend_flow.id,
        cover_asset_path.strip().lstrip("/"),
    )


def serialize_trend_flow_public(trend_flow: TrendFlowRecord) -> dict:
    payload = trend_flow.model_dump(by_alias=True)
    metadata = parse_trend_flow_metadata_json(trend_flow.metadata_json)
    entry_path = _resolve_trend_flow_entry_path(trend_flow, metadata)
    payload["previewUrl"] = f"/api/trend-flow/{trend_flow.id}/preview/{quote(entry_path, safe='/')}"
    payload["status"] = "published"
    payload["timeline"] = _parse_timeline_payload(trend_flow)
    payload["windowLabel"] = _build_window_label(trend_flow)
    payload["leadExcerpt"] = trend_flow.lead_excerpt or metadata.get("lead_excerpt") or metadata.get("leadExcerpt")
    payload["coverHtml"] = _resolve_trend_flow_cover_html(trend_flow, metadata)
    payload["coverHtmlSource"] = metadata.get("coverHtmlSource") if payload["coverHtml"] else None
    return payload


def update_trend_flow_admin(
    trend_flow_id: int,
    *,
    title: str | None = None,
    brand: str | None = None,
    start_quarter: str | None = None,
    start_year: int | None = None,
    end_quarter: str | None = None,
    end_year: int | None = None,
    cover_url: str | None = None,
    lead_excerpt: str | None = None,
) -> TrendFlowRecord | None:
    current = find_trend_flow_by_id(trend_flow_id)
    if current is None:
        return None

    metadata = parse_trend_flow_metadata_json(current.metadata_json)
    metadata_dirty = False

    if lead_excerpt is not None:
        normalized_excerpt = lead_excerpt.strip()
        if normalized_excerpt:
            metadata["lead_excerpt"] = normalized_excerpt
            metadata["leadExcerpt"] = normalized_excerpt
        else:
            metadata.pop("lead_excerpt", None)
            metadata.pop("leadExcerpt", None)
        metadata_dirty = True

    next_start_quarter = start_quarter.strip() if isinstance(start_quarter, str) else current.start_quarter
    next_start_year = start_year if start_year is not None else current.start_year
    next_end_quarter = end_quarter.strip() if isinstance(end_quarter, str) else current.end_quarter
    next_end_year = end_year if end_year is not None else current.end_year

    timeline = _parse_timeline_payload(current)
    timeline_dirty = False
    if start_quarter is not None or start_year is not None or end_quarter is not None or end_year is not None:
        if len(timeline) >= 2:
            timeline[0] = {**timeline[0], "quarter": next_start_quarter, "year": next_start_year}
            timeline[-1] = {**timeline[-1], "quarter": next_end_quarter, "year": next_end_year}
        else:
            timeline = [
                {"quarter": next_start_quarter, "year": next_start_year},
                {"quarter": next_end_quarter, "year": next_end_year},
            ]
        metadata["timeline"] = timeline
        metadata_dirty = True
        timeline_dirty = True

    return update_trend_flow_admin_fields(
        trend_flow_id,
        title=title.strip() if isinstance(title, str) else None,
        brand=brand.strip() if isinstance(brand, str) else None,
        start_quarter=next_start_quarter if start_quarter is not None else None,
        start_year=next_start_year if start_year is not None else None,
        end_quarter=next_end_quarter if end_quarter is not None else None,
        end_year=next_end_year if end_year is not None else None,
        cover_url=cover_url.strip() if isinstance(cover_url, str) else None,
        timeline_json=timeline if timeline_dirty else None,
        metadata_json=metadata if metadata_dirty else None,
    )


def delete_trend_flow_with_files(trend_flow_id: int) -> bool:
    trend_flow = find_trend_flow_by_id(trend_flow_id)
    if not trend_flow:
        return False

    deleted = delete_trend_flow(trend_flow_id)
    if deleted and trend_flow.oss_prefix:
        try:
            count = get_oss_service().delete_prefix(trend_flow.oss_prefix)
            logger.info(
                "Deleted %d OSS files for trend flow %s (prefix: %s)",
                count,
                trend_flow.slug,
                trend_flow.oss_prefix,
            )
        except Exception as exc:
            logger.warning("Failed to delete OSS files for trend flow %s: %s", trend_flow.slug, exc)
    return deleted


def _safe_join(base: Path, target: str) -> Path:
    resolved = (base / target).resolve()
    base_resolved = base.resolve()
    try:
        resolved.relative_to(base_resolved)
    except ValueError as exc:
        raise AppError("压缩包包含非法路径", 400) from exc
    return resolved


def _extract_archive(archive_path: Path, dest: Path) -> None:
    with zipfile.ZipFile(archive_path, "r") as zf:
        for info in zf.infolist():
            output_path = _safe_join(dest, info.filename)
            if info.is_dir():
                output_path.mkdir(parents=True, exist_ok=True)
            else:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(output_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)


def _resolve_bundle_root(extraction_dir: Path) -> Path:
    children = [c for c in extraction_dir.iterdir() if c.is_dir()]
    root_files = [c for c in extraction_dir.iterdir() if c.is_file()]
    if len(children) == 1 and not root_files:
        return children[0]
    return extraction_dir


def upload_trend_flow_archive(archive_path: str, uploaded_by: int) -> TrendFlowRecord:
    upload_tmp_dir = settings.resolved_upload_tmp_dir
    upload_tmp_dir.mkdir(parents=True, exist_ok=True)
    extraction_dir = Path(tempfile.mkdtemp(prefix="trend-flow-", dir=str(upload_tmp_dir)))

    try:
        _extract_archive(Path(archive_path), extraction_dir)
        trend_flow_root = _resolve_bundle_root(extraction_dir)
        artifact = compile_trend_flow_package(trend_flow_root)
        if find_trend_flow_by_slug(artifact.slug):
            raise AppError(f"趋势流动 slug 已存在: {artifact.slug}", 409)

        oss_result = upload_report_to_oss(
            trend_flow_root,
            artifact.slug,
            namespace="trend-flow",
            validate_manifest=False,
        )
        record = create_trend_flow(
            slug=artifact.slug,
            title=artifact.title,
            brand=artifact.brand,
            start_quarter=artifact.timeline[0].quarter,
            start_year=artifact.timeline[0].year,
            end_quarter=artifact.timeline[-1].quarter,
            end_year=artifact.timeline[-1].year,
            index_url=oss_result.index_url,
            overview_url=oss_result.overview_url,
            cover_url=oss_result.cover_url,
            oss_prefix=oss_result.oss_prefix,
            uploaded_by=uploaded_by,
            timeline_json=artifact.timeline_payload,
            metadata_json=artifact.metadata_payload(),
            lead_excerpt=artifact.lead_excerpt,
        )
        logger.info("Uploaded trend flow %s for brand %s", record.slug, record.brand)
        return record
    finally:
        shutil.rmtree(extraction_dir, ignore_errors=True)
        archive = Path(archive_path)
        if archive.exists():
            archive.unlink(missing_ok=True)
