from backend.app.models import AuthenticatedUser
from backend.app.routers import admin as admin_router


def _admin_user() -> AuthenticatedUser:
    return AuthenticatedUser(id=1, email="admin@example.com", role="admin")


def test_get_system_dna_status(monkeypatch):
    monkeypatch.setattr(
        admin_router,
        "get_system_taste_profile_status",
        lambda: {"profile_status": "ready", "metadata": {"matched_brand_count": 8}},
    )

    response = admin_router.get_system_dna_status(user=_admin_user())

    assert response == {
        "success": True,
        "data": {"profile_status": "ready", "metadata": {"matched_brand_count": 8}},
    }


def test_rebuild_system_dna(monkeypatch):
    monkeypatch.setattr(
        admin_router,
        "rebuild_system_taste_profile",
        lambda: {"profile_status": "ready", "profile_vector_type": "fashion_clip"},
    )

    response = admin_router.rebuild_system_dna(user=_admin_user())

    assert response == {
        "success": True,
        "data": {"profile_status": "ready", "profile_vector_type": "fashion_clip"},
    }


def test_delete_admin_report(monkeypatch):
    monkeypatch.setattr(
        admin_router,
        "delete_report_with_files",
        lambda report_id: report_id == 42,
    )

    response = admin_router.delete_admin_report(report_id=42, user=_admin_user())

    assert response == {
        "success": True,
        "data": {"deleted": True, "reportId": 42},
    }
