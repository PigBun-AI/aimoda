import json

from backend.app.services import report_uploader
from backend.app.services import oss_service


class FakeOSS:
    def __init__(self):
        self.uploads = []

    def upload_file(self, oss_path, file_content, content_type=None, metadata=None, public_base_url=None):
        if isinstance(file_content, bytes):
            content = file_content
        else:
            content = file_content.read()
        self.uploads.append((oss_path, content_type, content, public_base_url))
        base = (public_base_url or oss_service.settings.OSS_PUBLIC_BASE or "https://oss.example.com").rstrip("/")
        return f"{base}/{oss_path}"


def test_upload_report_preserves_relative_paths_and_uses_manifest_entry(tmp_path, monkeypatch):
    report_root = tmp_path / "report"
    (report_root / "pages").mkdir(parents=True)
    (report_root / "assets").mkdir()

    (report_root / "pages" / "report.html").write_text(
        '<html><body><img src="../assets/look-001.jpg"><a href="./data.html">data</a></body></html>',
        encoding="utf-8",
    )
    (report_root / "pages" / "data.html").write_text("<html><body>data</body></html>", encoding="utf-8")
    (report_root / "assets" / "look-001.jpg").write_bytes(b"image")
    (report_root / "assets" / "cover.jpg").write_bytes(b"cover")
    (report_root / "image-features.json").write_text(json.dumps({"a": {}, "b": {}}), encoding="utf-8")
    (report_root / "manifest.json").write_text(
        json.dumps(
            {
                "specVersion": "2.0",
                "slug": "murmur-aw-2026-27-v5-2",
                "title": "Murmur 2026-27 秋冬 时装周快报",
                "brand": "Murmur",
                "season": "AW",
                "year": 2026,
                "entryHtml": "pages/report.html",
                "pages": ["pages/report.html", "pages/data.html"],
                "coverImage": "assets/cover.jpg",
                "featuresFile": "image-features.json"
            }
        ),
        encoding="utf-8",
    )

    fake_oss = FakeOSS()
    monkeypatch.setattr(report_uploader, "get_oss_service", lambda: fake_oss)
    monkeypatch.setattr(oss_service.settings, "OSS_PUBLIC_BASE", None)

    result = report_uploader.upload_report_to_oss(report_root, "murmur-aw-2026-27-v5-2")

    uploaded_paths = {path for path, _content_type, _content, _public_base in fake_oss.uploads}
    assert uploaded_paths == {
        "reports/murmur-aw-2026-27-v5-2/pages/report.html",
        "reports/murmur-aw-2026-27-v5-2/pages/data.html",
        "reports/murmur-aw-2026-27-v5-2/assets/look-001.jpg",
        "reports/murmur-aw-2026-27-v5-2/assets/cover.jpg",
        "reports/murmur-aw-2026-27-v5-2/image-features.json",
    }
    assert result.index_url == "https://oss.example.com/reports/murmur-aw-2026-27-v5-2/pages/report.html"
    assert result.overview_url is None
    assert result.cover_url == "https://oss.example.com/reports/murmur-aw-2026-27-v5-2/assets/cover.jpg"
    assert result.image_count == 2


def test_upload_report_uses_oss_public_base_when_configured(tmp_path, monkeypatch):
    report_root = tmp_path / "report"
    (report_root / "pages").mkdir(parents=True)
    (report_root / "pages" / "report.html").write_text("<html><body>ok</body></html>", encoding="utf-8")
    (report_root / "manifest.json").write_text(
        json.dumps(
            {
                "specVersion": "2.0",
                "slug": "report-preview-test",
                "title": "Report Preview Test",
                "brand": "Aimoda",
                "season": "AW",
                "year": 2026,
                "entryHtml": "pages/report.html",
            }
        ),
        encoding="utf-8",
    )

    fake_oss = FakeOSS()
    monkeypatch.setattr(report_uploader, "get_oss_service", lambda: fake_oss)
    monkeypatch.setattr(oss_service.settings, "OSS_PUBLIC_BASE", "https://static.ai-moda.ai")

    result = report_uploader.upload_report_to_oss(report_root, "report-preview-test")

    assert result.index_url == "https://static.ai-moda.ai/reports/report-preview-test/pages/report.html"
    assert fake_oss.uploads[0][3] is None
