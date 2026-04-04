import io

from PIL import Image

from backend.app.services import report_cover_service


def _png_bytes(size=(1200, 800)) -> bytes:
    image = Image.new("RGB", size, color=(240, 240, 240))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_generate_report_cover_uploads_normalized_16_9_image(monkeypatch):
    class FakeResponse:
        def __init__(self, content: bytes):
            self.content = content

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, endpoint, params=None, json=None):
            assert endpoint == "http://report-cover-browser:3000/screenshot"
            assert params == {"token": "secret-token"}
            assert json["url"] == "https://static.ai-moda.ai/reports/test/pages/report.html"
            return FakeResponse(_png_bytes())

    class FakeOSS:
        def upload_file(self, oss_path, file_content, content_type=None, metadata=None, public_base_url=None):
            assert oss_path == "reports/test/assets/generated-cover-16x9.jpg"
            assert content_type == "image/jpeg"
            with Image.open(io.BytesIO(file_content)) as image:
                assert image.size == (1600, 900)
            return f"https://static.ai-moda.ai/{oss_path}"

    monkeypatch.setattr(report_cover_service.settings, "REPORT_COVER_GENERATION_ENABLED", True)
    monkeypatch.setattr(report_cover_service.settings, "REPORT_COVER_BROWSERLESS_URL", "http://report-cover-browser:3000")
    monkeypatch.setattr(report_cover_service.settings, "REPORT_COVER_BROWSERLESS_TOKEN", "secret-token")
    monkeypatch.setattr(report_cover_service.settings, "REPORT_COVER_WIDTH", 1600)
    monkeypatch.setattr(report_cover_service.settings, "REPORT_COVER_HEIGHT", 900)
    monkeypatch.setattr(report_cover_service.httpx, "Client", FakeClient)
    monkeypatch.setattr(report_cover_service, "get_oss_service", lambda: FakeOSS())

    url = report_cover_service.generate_report_cover(
        "https://static.ai-moda.ai/reports/test/pages/report.html",
        "test",
    )

    assert url == "https://static.ai-moda.ai/reports/test/assets/generated-cover-16x9.jpg"


def test_generate_report_cover_returns_none_when_disabled(monkeypatch):
    monkeypatch.setattr(report_cover_service.settings, "REPORT_COVER_GENERATION_ENABLED", False)
    assert report_cover_service.generate_report_cover("https://example.com/report.html", "test") is None
