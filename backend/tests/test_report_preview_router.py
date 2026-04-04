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
        def download_file_with_meta(self, oss_path: str):
            assert oss_path == "reports/murmur-aw-2026-27-v5-2/assets/look-001.jpg"
            return b"image-bytes", "image/jpeg"

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

    assert response.body == b"image-bytes"
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.headers["cache-control"] == "private, max-age=300"


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
