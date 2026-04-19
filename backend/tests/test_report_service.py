from pathlib import Path

from backend.app.services import report_service
from backend.app.models import ReportRecord


def test_resolve_report_root_keeps_flat_zip_root_with_manifest(tmp_path: Path):
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    pages_dir = tmp_path / "pages"
    pages_dir.mkdir()
    (pages_dir / "report.html").write_text("<html></html>", encoding="utf-8")

    resolved = report_service._resolve_report_root(tmp_path)

    assert resolved == tmp_path


def test_get_reports_forwards_search_query(monkeypatch):
    calls: dict[str, object] = {}
    monkeypatch.setattr(
        report_service,
        "list_reports",
        lambda page, limit, q=None: (calls.update({"page": page, "limit": limit, "q": q}) or ([], 0)),
    )

    items, total = report_service.get_reports(page=3, limit=9, q="AW26")

    assert items == []
    assert total == 0
    assert calls == {"page": 3, "limit": 9, "q": "AW26"}


def test_resolve_report_root_descends_when_archive_has_single_wrapper_dir(tmp_path: Path):
    wrapper = tmp_path / "wrapped-report"
    wrapper.mkdir()
    (wrapper / "manifest.json").write_text("{}", encoding="utf-8")

    resolved = report_service._resolve_report_root(tmp_path)

    assert resolved == wrapper


def test_resolve_report_lead_excerpt_backfills_metadata(monkeypatch):
    report = ReportRecord(
        id=7,
        slug="lead-report",
        title="Lead Report",
        brand="Lead",
        season="AW",
        year=2026,
        look_count=12,
        index_url="https://aimoda.oss-cn-shenzhen.aliyuncs.com/reports/lead-report/pages/report.html",
        overview_url=None,
        cover_url="https://aimoda.oss-cn-shenzhen.aliyuncs.com/reports/lead-report/assets/cover.jpg",
        oss_prefix="reports/lead-report",
        uploaded_by=1,
        metadata_json='{"entry_html": "pages/report.html"}',
        created_at="2026-04-04T00:00:00Z",
        updated_at="2026-04-04T00:00:00Z",
    )

    persisted: dict | None = None

    class FakeOSS:
        def download_file_with_meta_processed(self, oss_path: str, *, process: str | None = None):
            assert process is None
            assert oss_path == "reports/lead-report/pages/report.html"
            return (
                "<html><body><p>这是一段足够长的首页导语文案，用来说明本次报告聚焦的品牌轮廓、版型变化与关键单品信号。</p></body></html>".encode("utf-8"),
                "text/html; charset=utf-8",
            )

    def fake_update(report_id: int, metadata_json: dict | None):
        nonlocal persisted
        assert report_id == 7
        persisted = metadata_json

    monkeypatch.setattr(report_service, "get_oss_service", lambda: FakeOSS())
    monkeypatch.setattr(report_service, "update_report_metadata", fake_update)

    excerpt = report_service.resolve_report_lead_excerpt(report)

    assert excerpt == "这是一段足够长的首页导语文案，用来说明本次报告聚焦的品牌轮廓、版型变化与关键单品信号。"
    assert persisted == {
        "entry_html": "pages/report.html",
        "lead_excerpt": "这是一段足够长的首页导语文案，用来说明本次报告聚焦的品牌轮廓、版型变化与关键单品信号。",
    }


def test_delete_report_with_files_removes_report_views_before_report(monkeypatch):
    report = ReportRecord(
        id=12,
        slug="delete-me",
        title="Delete Me",
        brand="Brand",
        season="AW",
        year=2026,
        look_count=8,
        index_url="https://example.com/report.html",
        overview_url=None,
        cover_url=None,
        oss_prefix="reports/delete-me",
        uploaded_by=1,
        metadata_json=None,
        created_at="2026-04-04T00:00:00Z",
        updated_at="2026-04-04T00:00:00Z",
    )

    deleted_prefixes: list[str] = []

    class FakeOSS:
        def delete_prefix(self, prefix: str) -> int:
            deleted_prefixes.append(prefix)
            return 3

    monkeypatch.setattr(report_service, "find_report_by_id", lambda report_id: report if report_id == 12 else None)
    monkeypatch.setattr(report_service, "_delete_report_records", lambda report_id: report_id == 12)
    monkeypatch.setattr(report_service, "get_oss_service", lambda: FakeOSS())

    deleted = report_service.delete_report_with_files(12)

    assert deleted is True
    assert deleted_prefixes == ["reports/delete-me"]


def test_delete_report_with_files_tolerates_oss_cleanup_failure(monkeypatch):
    report = ReportRecord(
        id=18,
        slug="cleanup-warning",
        title="Cleanup Warning",
        brand="Brand",
        season="SS",
        year=2026,
        look_count=5,
        index_url="https://example.com/report.html",
        overview_url=None,
        cover_url=None,
        oss_prefix="reports/cleanup-warning",
        uploaded_by=1,
        metadata_json=None,
        created_at="2026-04-04T00:00:00Z",
        updated_at="2026-04-04T00:00:00Z",
    )

    class FakeOSS:
        def delete_prefix(self, prefix: str) -> int:
            raise RuntimeError(f"boom:{prefix}")

    monkeypatch.setattr(report_service, "find_report_by_id", lambda report_id: report if report_id == 18 else None)
    monkeypatch.setattr(report_service, "_delete_report_records", lambda report_id: report_id == 18)
    monkeypatch.setattr(report_service, "get_oss_service", lambda: FakeOSS())

    deleted = report_service.delete_report_with_files(18)

    assert deleted is True
