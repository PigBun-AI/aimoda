from __future__ import annotations

import logging
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
    find_trend_flow_by_id,
    find_trend_flow_by_slug,
    list_trend_flows,
)
from .report_scanner import (
    load_report_manifest,
    resolve_report_cover_image,
    resolve_report_entry_html,
    resolve_report_overview_html,
)
from .report_uploader import upload_report_to_oss
from .trend_flow_scanner import extract_trend_flow_metadata, parse_trend_flow_metadata_json

logger = logging.getLogger(__name__)


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


def serialize_trend_flow_public(trend_flow: TrendFlowRecord) -> dict:
    payload = trend_flow.model_dump(by_alias=True)
    metadata = parse_trend_flow_metadata_json(trend_flow.metadata_json)
    entry_path = _resolve_trend_flow_entry_path(trend_flow, metadata)
    payload["previewUrl"] = f"/api/trend-flow/{trend_flow.id}/preview/{quote(entry_path, safe='/')}"
    payload["status"] = "published"
    payload["timeline"] = _parse_timeline_payload(trend_flow)
    payload["windowLabel"] = _build_window_label(trend_flow)
    payload["leadExcerpt"] = trend_flow.lead_excerpt or metadata.get("lead_excerpt") or metadata.get("leadExcerpt")
    return payload


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
        metadata = extract_trend_flow_metadata(trend_flow_root)
        if find_trend_flow_by_slug(metadata.slug):
            raise AppError(f"趋势流动 slug 已存在: {metadata.slug}", 409)

        manifest = load_report_manifest(trend_flow_root) or {}
        oss_result = upload_report_to_oss(
            trend_flow_root,
            metadata.slug,
            namespace="trend-flow",
            validate_manifest=False,
        )
        overview_path = resolve_report_overview_html(trend_flow_root, manifest)
        cover = resolve_report_cover_image(trend_flow_root, manifest)
        timeline_payload = [point.model_dump(by_alias=True) for point in metadata.timeline]
        metadata_payload = {
            "entryHtml": resolve_report_entry_html(trend_flow_root, manifest).relative_to(trend_flow_root).as_posix(),
            "overviewHtml": overview_path.relative_to(trend_flow_root).as_posix() if overview_path else None,
            "coverImage": cover.path.relative_to(trend_flow_root).as_posix() if cover else None,
            "timeline": timeline_payload,
            "lead_excerpt": metadata.lead_excerpt,
        }
        record = create_trend_flow(
            slug=metadata.slug,
            title=metadata.title,
            brand=metadata.brand,
            start_quarter=metadata.timeline[0].quarter,
            start_year=metadata.timeline[0].year,
            end_quarter=metadata.timeline[-1].quarter,
            end_year=metadata.timeline[-1].year,
            index_url=oss_result.index_url,
            overview_url=oss_result.overview_url,
            cover_url=oss_result.cover_url,
            oss_prefix=oss_result.oss_prefix,
            uploaded_by=uploaded_by,
            timeline_json=timeline_payload,
            metadata_json=metadata_payload,
            lead_excerpt=metadata.lead_excerpt,
        )
        logger.info("Uploaded trend flow %s for brand %s", record.slug, record.brand)
        return record
    finally:
        shutil.rmtree(extraction_dir, ignore_errors=True)
        archive = Path(archive_path)
        if archive.exists():
            archive.unlink(missing_ok=True)
