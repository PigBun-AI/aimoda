import json
from pathlib import Path
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

from backend.app.services.report_uploader import ReportOSSResult
from backend.app.services import trend_flow_service


def _build_trend_flow_zip(tmp_path: Path) -> Path:
    root = tmp_path / "trend-flow"
    (root / "pages").mkdir(parents=True)
    (root / "assets").mkdir(parents=True)
    (root / "pages" / "report.html").write_text(
        "<html><head><title>Demo Trend Flow</title></head><body><p>Demo excerpt for trend flow upload smoke test.</p></body></html>",
        encoding="utf-8",
    )
    (root / "assets" / "cover.svg").write_text(
        "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='#000'/></svg>",
        encoding="utf-8",
    )
    (root / "manifest.json").write_text(
        json.dumps(
            {
                "slug": "demo-brand-2025-trend-flow",
                "title": "Demo Brand 趋势流动：2025",
                "brand": "Demo Brand",
                "timeline": [
                    {"quarter": "早春", "year": 2025},
                    {"quarter": "春夏", "year": 2025},
                    {"quarter": "早秋", "year": 2025},
                    {"quarter": "秋冬", "year": 2025},
                ],
                "entryHtml": "pages/report.html",
                "coverImage": "assets/cover.svg",
            }
        ),
        encoding="utf-8",
    )

    zip_path = tmp_path / "trend-flow.zip"
    with ZipFile(zip_path, "w", ZIP_DEFLATED) as archive:
        for path in root.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(root))
    return zip_path


def test_upload_trend_flow_archive_skips_report_manifest_validation(monkeypatch, tmp_path):
    zip_path = _build_trend_flow_zip(tmp_path)
    captured: dict[str, object] = {}

    def _fake_upload_report_to_oss(report_root, slug, *, namespace="reports", validate_manifest=True):
        captured["slug"] = slug
        captured["namespace"] = namespace
        captured["validate_manifest"] = validate_manifest
        return ReportOSSResult(
            index_url="https://oss.example.com/trend-flow/demo/pages/report.html",
            overview_url=None,
            cover_url="https://oss.example.com/trend-flow/demo/assets/cover.svg",
            oss_prefix="trend-flow/demo-brand-2025-trend-flow/",
        )

    def _fake_create_trend_flow(**kwargs):
        return SimpleNamespace(id=1, created_at="2026-04-23T00:00:00Z", updated_at="2026-04-23T00:00:00Z", **kwargs)

    monkeypatch.setattr(trend_flow_service, "upload_report_to_oss", _fake_upload_report_to_oss)
    monkeypatch.setattr(trend_flow_service, "create_trend_flow", _fake_create_trend_flow)
    monkeypatch.setattr(trend_flow_service, "find_trend_flow_by_slug", lambda slug: None)

    record = trend_flow_service.upload_trend_flow_archive(str(zip_path), uploaded_by=7)

    assert record.slug == "demo-brand-2025-trend-flow"
    assert captured["namespace"] == "trend-flow"
    assert captured["validate_manifest"] is False
