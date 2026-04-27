from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..constants import TREND_FLOW_SPEC
from ..models import TrendFlowTimelinePoint
from .report_package_errors import ReportPackageError
from .report_scanner import (
    load_report_manifest,
    resolve_report_cover_image,
    resolve_report_entry_html,
    resolve_report_overview_html,
)
from .trend_flow_scanner import (
    extract_trend_flow_metadata,
    require_trend_flow_cover_template,
)


@dataclass(frozen=True)
class TrendFlowCompiledArtifact:
    """Strict, stable artifact consumed by persistence and render layers."""

    package_root: Path
    manifest: dict[str, Any]
    slug: str
    title: str
    brand: str
    timeline: list[TrendFlowTimelinePoint]
    entry_html: str
    overview_html: str | None
    cover_image: str | None
    cover_html: str
    cover_html_asset_path: str
    cover_html_source: str
    lead_excerpt: str | None
    contract_version: str

    @property
    def timeline_payload(self) -> list[dict[str, Any]]:
        return [point.model_dump(by_alias=True) for point in self.timeline]

    def metadata_payload(self) -> dict[str, Any]:
        return {
            "contract": {
                "type": "trend_flow_package",
                "version": self.contract_version,
                "strict": True,
            },
            "entryHtml": self.entry_html,
            "overviewHtml": self.overview_html,
            "coverImage": self.cover_image,
            "coverHtml": self.cover_html,
            "coverHtmlAssetPath": self.cover_html_asset_path,
            "coverHtmlSource": self.cover_html_source,
            "timeline": self.timeline_payload,
            "lead_excerpt": self.lead_excerpt,
        }


def compile_trend_flow_package(package_root: Path) -> TrendFlowCompiledArtifact:
    """Validate a Trend Flow package and compile it into one stable artifact.

    Creative HTML can vary freely, but this function is the strict boundary that
    turns a ZIP package into the fields the backend stores and the frontend reads.
    """

    manifest = load_report_manifest(package_root)
    if not manifest:
        raise ReportPackageError("missing_manifest", "趋势流动 ZIP 必须包含 manifest.json")

    metadata = extract_trend_flow_metadata(package_root)
    entry_path = resolve_report_entry_html(package_root, manifest)
    overview_path = resolve_report_overview_html(package_root, manifest)
    cover_image = resolve_report_cover_image(package_root, manifest)
    cover_marker = require_trend_flow_cover_template(entry_path, package_root)

    return TrendFlowCompiledArtifact(
        package_root=package_root,
        manifest=manifest,
        slug=metadata.slug,
        title=metadata.title,
        brand=metadata.brand,
        timeline=metadata.timeline,
        entry_html=entry_path.relative_to(package_root).as_posix(),
        overview_html=overview_path.relative_to(package_root).as_posix() if overview_path else None,
        cover_image=cover_image.path.relative_to(package_root).as_posix() if cover_image else None,
        cover_html=cover_marker.html,
        cover_html_asset_path=cover_marker.asset_path,
        cover_html_source=cover_marker.source,
        lead_excerpt=metadata.lead_excerpt,
        contract_version=str(TREND_FLOW_SPEC["version"]),
    )
