from __future__ import annotations

from html import escape
from html.parser import HTMLParser
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..models import TrendFlowMetadata, TrendFlowTimelinePoint
from ..value_normalization import normalize_quarter_value
from .report_package_errors import ReportPackageError
from .report_scanner import (
    _resolve_package_path,
    _validate_all_html_files,
    extract_report_lead_excerpt,
    load_report_manifest,
    resolve_report_entry_html,
    resolve_report_overview_html,
)

_QUARTER_ORDER = ("早春", "春夏", "早秋", "秋冬")
_QUARTER_INDEX = {quarter: index for index, quarter in enumerate(_QUARTER_ORDER)}
TREND_FLOW_COVER_TEMPLATE_ID = "aimoda-trend-flow-cover"
TREND_FLOW_COVER_FRAGMENT_ATTR = "data-aimoda-cover-fragment"
VOID_HTML_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
TREND_FLOW_COVER_TEMPLATE_PATTERN = re.compile(
    r"<template\b(?P<attrs>[^>]*)>(?P<body>.*?)</template>",
    re.IGNORECASE | re.DOTALL,
)
HEAD_STYLE_PATTERN = re.compile(r"<style\b[^>]*>.*?</style>", re.IGNORECASE | re.DOTALL)
STYLESHEET_LINK_PATTERN = re.compile(
    r"<link\b(?=[^>]*\brel=[\"'][^\"']*\bstylesheet\b[^\"']*[\"'])[^>]*>",
    re.IGNORECASE | re.DOTALL,
)
HTML_ATTR_PATTERN = re.compile(
    r"(?P<name>[a-zA-Z_:][-a-zA-Z0-9_:.]*)"
    r"(?:\s*=\s*(?:\"(?P<double>[^\"]*)\"|'(?P<single>[^']*)'|(?P<bare>[^\s\"'=<>`]+)))?",
    re.IGNORECASE,
)
UNSAFE_COVER_ELEMENT_PATTERN = re.compile(
    r"<(script|iframe|object|embed|form)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
UNSAFE_SELF_CLOSING_COVER_ELEMENT_PATTERN = re.compile(
    r"<(script|iframe|object|embed|form)\b[^>]*?/?>",
    re.IGNORECASE | re.DOTALL,
)
INLINE_EVENT_HANDLER_PATTERN = re.compile(
    r"\s+on[a-zA-Z]+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)",
    re.IGNORECASE,
)
JAVASCRIPT_URL_PATTERN = re.compile(
    r"(?P<prefix>\b(?:href|src)\s*=\s*[\"'])\s*javascript:[^\"']*(?P<suffix>[\"'])",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class TrendFlowCoverTemplate:
    html: str
    asset_path: str
    source: str


class CoverFragmentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.fragments: list[str] = []
        self._capturing = False
        self._capture_depth = 0
        self._chunks: list[str] = []
        self._tag_stack: list[str] = []

    @staticmethod
    def _render_attrs(attrs: list[tuple[str, str | None]]) -> str:
        rendered = []
        for name, value in attrs:
            if value is None:
                rendered.append(name)
            else:
                rendered.append(f'{name}="{escape(value, quote=True)}"')
        return f" {' '.join(rendered)}" if rendered else ""

    def _append(self, value: str) -> None:
        if self._capturing:
            self._chunks.append(value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_names = {name.lower() for name, _ in attrs}
        is_cover_fragment = TREND_FLOW_COVER_FRAGMENT_ATTR in attr_names
        if is_cover_fragment and not self._capturing:
            self._capturing = True
            self._capture_depth = 0
            self._chunks = []

        if self._capturing:
            if tag.lower() not in VOID_HTML_TAGS:
                self._capture_depth += 1
                self._tag_stack.append(tag.lower())
            self._chunks.append(f"<{tag}{self._render_attrs(attrs)}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._capturing:
            self._chunks.append(f"<{tag}{self._render_attrs(attrs)} />")

    def handle_endtag(self, tag: str) -> None:
        if not self._capturing:
            return

        self._chunks.append(f"</{tag}>")
        self._capture_depth -= 1
        if self._tag_stack:
            self._tag_stack.pop()
        if self._capture_depth == 0:
            self.fragments.append("".join(self._chunks).strip())
            self._capturing = False
            self._chunks = []
            self._tag_stack = []

    def handle_data(self, data: str) -> None:
        if self._tag_stack and self._tag_stack[-1] == "style":
            self._append(data)
            return
        self._append(escape(data, quote=False))

    def handle_entityref(self, name: str) -> None:
        self._append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self._append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self._append(f"<!--{data}-->")


def _normalize_slug(name: str) -> str:
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def _infer_title(html: str) -> str | None:
    title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if title_match and title_match.group(1).strip():
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", title_match.group(1))).strip()
    return None


def _parse_html_attrs(attrs: str) -> dict[str, str | None]:
    parsed: dict[str, str | None] = {}
    for match in HTML_ATTR_PATTERN.finditer(attrs):
        name = match.group("name").lower()
        value = match.group("double")
        if value is None:
            value = match.group("single")
        if value is None:
            value = match.group("bare")
        parsed[name] = value
    return parsed


def _sanitize_cover_template_html(html: str) -> str:
    cleaned = UNSAFE_COVER_ELEMENT_PATTERN.sub("", html)
    cleaned = UNSAFE_SELF_CLOSING_COVER_ELEMENT_PATTERN.sub("", cleaned)
    cleaned = INLINE_EVENT_HANDLER_PATTERN.sub("", cleaned)
    cleaned = JAVASCRIPT_URL_PATTERN.sub(r"\g<prefix>#\g<suffix>", cleaned)
    return cleaned.strip()


def _extract_cover_fragment_html(html: str) -> list[str]:
    parser = CoverFragmentParser()
    parser.feed(html)
    parser.close()
    return [_sanitize_cover_template_html(fragment) for fragment in parser.fragments if fragment.strip()]


def _extract_document_cover_styles(html: str) -> str:
    styles = HEAD_STYLE_PATTERN.findall(html)
    stylesheet_links = STYLESHEET_LINK_PATTERN.findall(html)
    return "\n".join([*stylesheet_links, *styles]).strip()


def extract_trend_flow_cover_template(entry_path: Path, report_root: Path) -> TrendFlowCoverTemplate | None:
    html = entry_path.read_text(encoding="utf-8")
    matched_templates: list[TrendFlowCoverTemplate] = []
    for match in TREND_FLOW_COVER_TEMPLATE_PATTERN.finditer(html):
        attrs = _parse_html_attrs(match.group("attrs"))
        if attrs.get("id") != TREND_FLOW_COVER_TEMPLATE_ID or "data-aimoda-cover" not in attrs:
            continue

        cover_html = _sanitize_cover_template_html(match.group("body"))
        if not cover_html:
            raise ReportPackageError(
                "empty_trend_flow_cover_template",
                "趋势流动封面 template 不能为空",
            )

        matched_templates.append(
            TrendFlowCoverTemplate(
                html=cover_html,
                asset_path=entry_path.relative_to(report_root).as_posix(),
                source="entry_template",
            )
        )

    cover_fragments = _extract_cover_fragment_html(html)
    matched_fragments = [
        TrendFlowCoverTemplate(
            html="\n".join(part for part in (_extract_document_cover_styles(html), fragment) if part),
            asset_path=entry_path.relative_to(report_root).as_posix(),
            source="entry_fragment",
        )
        for fragment in cover_fragments
    ]
    matched_covers = [*matched_templates, *matched_fragments]

    if len(matched_covers) > 1:
        raise ReportPackageError(
            "duplicate_trend_flow_cover_marker",
            "entryHtml 中只能存在一个趋势流动封面标记：template 或 data-aimoda-cover-fragment 二选一",
        )
    if matched_covers:
        return matched_covers[0]
    return None


def require_trend_flow_cover_template(entry_path: Path, report_root: Path) -> TrendFlowCoverTemplate:
    cover_template = extract_trend_flow_cover_template(entry_path, report_root)
    if cover_template is None:
        raise ReportPackageError(
            "trend_flow_cover_marker_missing",
            "趋势流动 ZIP 必须在 entryHtml 中提供封面标记：<template id=\"aimoda-trend-flow-cover\" data-aimoda-cover> 或 data-aimoda-cover-fragment",
        )
    return cover_template


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
    for field in ("specVersion", "contentType", "slug", "title", "brand", "timeline", "entryHtml"):
        if manifest.get(field) in (None, ""):
            raise ReportPackageError(
                "missing_manifest_field",
                f"manifest 缺少必填字段 {field}",
                details={"field": field},
            )

    if manifest.get("contentType") != "trend_flow":
        raise ReportPackageError(
            "invalid_content_type",
            "manifest.contentType 必须是 trend_flow",
            details={"field": "contentType", "value": manifest.get("contentType")},
        )

    entry_path = resolve_report_entry_html(directory, manifest)
    resolve_report_overview_html(directory, manifest)
    _validate_all_html_files(directory)
    require_trend_flow_cover_template(entry_path, directory)

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
