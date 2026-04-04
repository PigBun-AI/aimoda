import pytest
from fastapi import Response

from backend.app.exceptions import AppError
from backend.app.models import AuthenticatedUser, ReportRecord
from backend.app.routers import reports as reports_router


def _report() -> ReportRecord:
    return ReportRecord(
        id=7,
        slug="murmur-aw-2026-27-v5-2",
        title="Murmur 2026-27 秋冬 时装周快报",
        brand="Murmur",
        season="AW",
        year=2026,
        look_count=38,
        index_url="https://aimoda.oss-cn-shenzhen.aliyuncs.com/reports/murmur-aw-2026-27-v5-2/pages/report.html",
        overview_url=None,
        cover_url="https://aimoda.oss-cn-shenzhen.aliyuncs.com/reports/murmur-aw-2026-27-v5-2/assets/cover.jpg",
        oss_prefix="reports/murmur-aw-2026-27-v5-2",
        uploaded_by=1,
        metadata_json=None,
        created_at="2026-04-04T00:00:00Z",
        updated_at="2026-04-04T00:00:00Z",
    )


def _user(role: str = "viewer") -> AuthenticatedUser:
    return AuthenticatedUser(
        id=12,
        email="viewer@aimoda.ai",
        role=role,
        session_id=99,
    )


def test_get_single_report_sets_preview_cookie_and_preview_url(monkeypatch):
    response = Response()
    monkeypatch.setattr(reports_router, "get_report", lambda _id: _report())
    monkeypatch.setattr(reports_router, "check_report_view_permission_dep", lambda report_id, user: None)
    monkeypatch.setattr(reports_router, "log_activity", lambda user_id, action: None)
    monkeypatch.setattr(reports_router, "get_view_status", lambda user_id, role: {"isUnlimited": False})
    monkeypatch.setattr(reports_router.settings, "FRONTEND_URL", "https://dev.ai-moda.ai")
    monkeypatch.setattr(reports_router.settings, "REPORT_PREVIEW_TOKEN_TTL_SECONDS", 600)

    payload = reports_router.get_single_report(
        report_id=7,
        user=_user(),
        response=response,
    )

    assert payload["success"] is True
    assert payload["data"]["previewUrl"] == "/api/reports/7/preview/pages/report.html"
    cookie = response.headers.get("set-cookie", "")
    assert "aimoda_report_preview=" in cookie
    assert "HttpOnly" in cookie
    assert "Max-Age=600" in cookie


def test_preview_report_asset_returns_content(monkeypatch):
    class FakeOSS:
        def get_url(self, oss_path: str) -> str:
            assert oss_path == "reports/murmur-aw-2026-27-v5-2/assets/look-001.jpg"
            return f"https://static.ai-moda.ai/{oss_path}"

    monkeypatch.setattr(reports_router, "get_report", lambda _id: _report())
    monkeypatch.setattr(reports_router, "verify_report_preview_token", lambda token: _user())
    monkeypatch.setattr(reports_router, "is_session_valid", lambda session_id: True)
    monkeypatch.setattr(reports_router, "has_viewed_report", lambda user_id, report_id: True)
    monkeypatch.setattr(reports_router, "find_active_subscription_by_user_id", lambda user_id: None)
    monkeypatch.setattr(reports_router, "get_oss_service", lambda: FakeOSS())

    response = reports_router.preview_report_asset(
        report_id=7,
        asset_path="assets/look-001.jpg",
        preview_token="preview-token",
    )

    assert response.status_code == 307
    assert response.headers["location"] == (
        "https://static.ai-moda.ai/reports/murmur-aw-2026-27-v5-2/assets/look-001.jpg"
    )
    assert response.headers["cache-control"] == "public, max-age=3600"


def test_preview_report_asset_injects_html_patch(monkeypatch):
    class FakeOSS:
        def get_url(self, oss_path: str) -> str:
            return f"https://static.ai-moda.ai/{oss_path}"

        def download_file_with_meta_processed(self, oss_path: str, *, process: str | None = None):
            assert oss_path == "reports/murmur-aw-2026-27-v5-2/pages/report.html"
            return (
                b"<html><body><img src=\"../assets/look-001.jpg\"><img srcset=\"../assets/look-001.jpg 1x, ../assets/look-002.jpg 2x\"></body></html>",
                "text/html; charset=utf-8",
            )

    monkeypatch.setattr(reports_router, "get_report", lambda _id: _report())
    monkeypatch.setattr(reports_router, "verify_report_preview_token", lambda token: _user())
    monkeypatch.setattr(reports_router, "is_session_valid", lambda session_id: True)
    monkeypatch.setattr(reports_router, "has_viewed_report", lambda user_id, report_id: True)
    monkeypatch.setattr(reports_router, "find_active_subscription_by_user_id", lambda user_id: None)
    monkeypatch.setattr(reports_router, "get_oss_service", lambda: FakeOSS())

    response = reports_router.preview_report_asset(
        report_id=7,
        asset_path="pages/report.html",
        preview_token="preview-token",
    )

    body = response.body.decode("utf-8")
    assert 'data-aimoda-report-preview-patch' in body
    assert "https://static.ai-moda.ai/reports/murmur-aw-2026-27-v5-2/assets/look-001.jpg" in body
    assert "https://static.ai-moda.ai/reports/murmur-aw-2026-27-v5-2/assets/look-002.jpg 2x" in body
    assert response.headers["content-type"].startswith("text/html")


def test_preview_report_asset_uses_oss_resize_for_thumbnail(monkeypatch):
    class FakeOSS:
        def get_url(self, oss_path: str) -> str:
            assert oss_path == "reports/murmur-aw-2026-27-v5-2/assets/look-001.jpg"
            return f"https://static.ai-moda.ai/{oss_path}"

    monkeypatch.setattr(reports_router, "get_report", lambda _id: _report())
    monkeypatch.setattr(reports_router, "verify_report_preview_token", lambda token: _user())
    monkeypatch.setattr(reports_router, "is_session_valid", lambda session_id: True)
    monkeypatch.setattr(reports_router, "has_viewed_report", lambda user_id, report_id: True)
    monkeypatch.setattr(reports_router, "find_active_subscription_by_user_id", lambda user_id: None)
    monkeypatch.setattr(reports_router, "get_oss_service", lambda: FakeOSS())

    response = reports_router.preview_report_asset(
        report_id=7,
        asset_path="assets/look-001.jpg",
        max_edge=1280,
        preview_token="preview-token",
    )

    assert response.status_code == 307
    assert response.headers["location"] == (
        "https://static.ai-moda.ai/reports/murmur-aw-2026-27-v5-2/assets/look-001.jpg"
        "?x-oss-process=image%2Fresize%2Cm_lfit%2Cw_1280%2Ch_1280%2Fquality%2Cq_85%2Fauto-orient%2C1"
    )


def test_preview_report_asset_rewrites_css_image_urls(monkeypatch):
    class FakeOSS:
        def get_url(self, oss_path: str) -> str:
            return f"https://static.ai-moda.ai/{oss_path}"

        def download_file_with_meta_processed(self, oss_path: str, *, process: str | None = None):
            assert oss_path == "reports/murmur-aw-2026-27-v5-2/pages/report.css"
            return (
                b".hero{background-image:url('../assets/look-001.jpg')} .icon{background:url(\"../assets/icon.svg\")}",
                "text/css; charset=utf-8",
            )

    monkeypatch.setattr(reports_router, "get_report", lambda _id: _report())
    monkeypatch.setattr(reports_router, "verify_report_preview_token", lambda token: _user())
    monkeypatch.setattr(reports_router, "is_session_valid", lambda session_id: True)
    monkeypatch.setattr(reports_router, "has_viewed_report", lambda user_id, report_id: True)
    monkeypatch.setattr(reports_router, "find_active_subscription_by_user_id", lambda user_id: None)
    monkeypatch.setattr(reports_router, "get_oss_service", lambda: FakeOSS())

    response = reports_router.preview_report_asset(
        report_id=7,
        asset_path="pages/report.css",
        preview_token="preview-token",
    )

    body = response.body.decode("utf-8")
    assert "https://static.ai-moda.ai/reports/murmur-aw-2026-27-v5-2/assets/look-001.jpg" in body
    assert "https://static.ai-moda.ai/reports/murmur-aw-2026-27-v5-2/assets/icon.svg" in body
    assert response.headers["content-type"].startswith("text/css")


def test_preview_report_asset_rejects_viewer_without_report_access(monkeypatch):
    monkeypatch.setattr(reports_router, "get_report", lambda _id: _report())
    monkeypatch.setattr(reports_router, "verify_report_preview_token", lambda token: _user())
    monkeypatch.setattr(reports_router, "is_session_valid", lambda session_id: True)
    monkeypatch.setattr(reports_router, "has_viewed_report", lambda user_id, report_id: False)
    monkeypatch.setattr(reports_router, "find_active_subscription_by_user_id", lambda user_id: None)

    with pytest.raises(AppError) as exc:
        reports_router.preview_report_asset(
            report_id=7,
            asset_path="pages/report.html",
            preview_token="preview-token",
        )

    assert exc.value.status_code == 403
