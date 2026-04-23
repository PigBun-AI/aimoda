from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ..models import TrendFlowMetadata, TrendFlowTimelinePoint
from ..value_normalization import normalize_quarter_value
from .report_package_errors import ReportPackageError
from .report_scanner import (
    _resolve_package_path,
    _resolve_required_cover_image,
    _validate_all_html_files,
    extract_report_lead_excerpt,
    load_report_manifest,
    resolve_report_entry_html,
    resolve_report_overview_html,
)

_QUARTER_ORDER = ("早春", "春夏", "早秋", "秋冬")
_QUARTER_INDEX = {quarter: index for index, quarter in enumerate(_QUARTER_ORDER)}


def _normalize_slug(name: str) -> str:
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def _infer_title(html: str) -> str | None:
    title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if title_match and title_match.group(1).strip():
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", title_match.group(1))).strip()
    return None


def _parse_timeline(raw_timeline: Any) -> list[TrendFlowTimelinePoint]:
    if not isinstance(raw_timeline, list):
        raise ReportPackageError("invalid_timeline", "manifest.timeline 必须是长度为 4 的数组")
    if len(raw_timeline) != 4:
        raise ReportPackageError("invalid_timeline_length", "manifest.timeline 必须正好包含 4 个季度节点")

    timeline: list[TrendFlowTimelinePoint] = []
    for item in raw_timeline:
        if not isinstance(item, dict):
            raise ReportPackageError("invalid_timeline_point", "manifest.timeline 中每个节点都必须是 object")
        quarter = normalize_quarter_value(item.get("quarter"))
        if quarter not in _QUARTER_INDEX:
            raise ReportPackageError("invalid_timeline_quarter", "manifest.timeline.quarter 必须是 早春 / 春夏 / 早秋 / 秋冬")
        try:
            year = int(item.get("year"))
        except (TypeError, ValueError) as exc:
            raise ReportPackageError("invalid_timeline_year", "manifest.timeline.year 必须是整数") from exc
        timeline.append(TrendFlowTimelinePoint(quarter=quarter, year=year))

    positions = [point.year * 4 + _QUARTER_INDEX[point.quarter] for point in timeline]
    if len(set(positions)) != 4:
        raise ReportPackageError("duplicate_timeline_point", "manifest.timeline 中存在重复季度节点")
    for index in range(1, len(positions)):
        if positions[index] != positions[index - 1] + 1:
            raise ReportPackageError("non_consecutive_timeline", "manifest.timeline 必须是连续四个季度")
    return timeline




def _validate_trend_flow_directory(directory: Path, manifest: dict[str, Any]) -> None:
    for field in ("slug", "brand", "timeline", "entryHtml"):
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

def extract_trend_flow_metadata(directory: Path) -> TrendFlowMetadata:
    manifest = load_report_manifest(directory)
    if not manifest:
        raise ReportPackageError("missing_manifest", "趋势流动 ZIP 必须包含 manifest.json")

    _validate_trend_flow_directory(directory, manifest)
    entry_path = resolve_report_entry_html(directory, manifest)
    entry_html = entry_path.read_text(encoding="utf-8")

    slug = _normalize_slug(str(manifest.get("slug", "") or ""))
    if not slug:
        raise ReportPackageError("invalid_slug", "manifest.slug 无法转换为合法 slug")

    title = str(manifest.get("title", "") or "").strip() or (_infer_title(entry_html) or "")
    if not title:
        raise ReportPackageError("title_not_found", "无法确定趋势流动标题：请填写 manifest.title 或在 entryHtml 中提供 <title>")

    brand = str(manifest.get("brand", "") or "").strip()
    if not brand:
        raise ReportPackageError("missing_manifest_field", "manifest.brand 不能为空")

    timeline = _parse_timeline(manifest.get("timeline"))

    return TrendFlowMetadata(
        slug=slug,
        title=title,
        brand=brand,
        timeline=timeline,
        lead_excerpt=extract_report_lead_excerpt(entry_html),
    )


def parse_trend_flow_metadata_json(metadata_json: str | None) -> dict[str, Any]:
    if not metadata_json:
        return {}
    try:
        payload = json.loads(metadata_json)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}
