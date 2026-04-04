from pathlib import Path

from backend.app.services import report_service


def test_resolve_report_root_keeps_flat_zip_root_with_manifest(tmp_path: Path):
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    pages_dir = tmp_path / "pages"
    pages_dir.mkdir()
    (pages_dir / "report.html").write_text("<html></html>", encoding="utf-8")

    resolved = report_service._resolve_report_root(tmp_path)

    assert resolved == tmp_path


def test_resolve_report_root_descends_when_archive_has_single_wrapper_dir(tmp_path: Path):
    wrapper = tmp_path / "wrapped-report"
    wrapper.mkdir()
    (wrapper / "manifest.json").write_text("{}", encoding="utf-8")

    resolved = report_service._resolve_report_root(tmp_path)

    assert resolved == wrapper
