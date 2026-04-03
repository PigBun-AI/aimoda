import pytest

from backend.app.exceptions import AppError
from backend.app.models import AuthenticatedUser, UpdateStyleGapRequest
from backend.app.routers import admin as admin_router


def _admin_user() -> AuthenticatedUser:
    return AuthenticatedUser(id=1, email="admin@example.com", role="admin")


def test_list_style_gaps_forwards_query_params(monkeypatch):
    captured = {}

    def _fake_list(**kwargs):
        captured.update(kwargs)
        return {"items": [{"id": "gap-1"}], "total": 1}

    monkeypatch.setattr(admin_router, "list_style_gap_feedback_admin", _fake_list)

    response = admin_router.list_style_gaps(
        status="open",
        q="blue dress",
        min_hits=2,
        sort="last_seen",
        order="asc",
        limit=25,
        offset=10,
        user=_admin_user(),
    )

    assert response["success"] is True
    assert response["data"]["total"] == 1
    assert captured == {
        "status": "open",
        "q": "blue dress",
        "min_hits": 2,
        "sort": "last_seen",
        "order": "asc",
        "limit": 25,
        "offset": 10,
    }


def test_update_style_gap_returns_404_when_signal_missing(monkeypatch):
    monkeypatch.setattr(admin_router, "update_style_gap_feedback_admin", lambda **_: None)

    with pytest.raises(AppError) as exc:
        admin_router.update_style_gap(
            signal_id="missing-id",
            body=UpdateStyleGapRequest(status="covered"),
            user=_admin_user(),
        )

    assert exc.value.status_code == 404


def test_update_style_gap_forwards_payload(monkeypatch):
    captured = {}

    def _fake_update(**kwargs):
        captured.update(kwargs)
        return {"id": "gap-1", "status": "ignored"}

    monkeypatch.setattr(admin_router, "update_style_gap_feedback_admin", _fake_update)

    response = admin_router.update_style_gap(
        signal_id="gap-1",
        body=UpdateStyleGapRequest(
            status="ignored",
            linked_style_name="quiet luxury",
            resolution_note="pending data source",
            resolved_by="admin",
        ),
        user=_admin_user(),
    )

    assert response["success"] is True
    assert response["data"]["status"] == "ignored"
    assert captured == {
        "signal_id": "gap-1",
        "status": "ignored",
        "linked_style_name": "quiet luxury",
        "resolution_note": "pending data source",
        "resolved_by": "admin",
    }


def test_get_style_gap_events_forwards_params(monkeypatch):
    captured = {}

    def _fake_events(**kwargs):
        captured.update(kwargs)
        return [{"id": "evt-1"}]

    monkeypatch.setattr(admin_router, "list_style_gap_events_admin", _fake_events)

    response = admin_router.get_style_gap_events(
        signal_id="gap-1",
        limit=12,
        user=_admin_user(),
    )

    assert response["success"] is True
    assert response["data"]["items"] == [{"id": "evt-1"}]
    assert captured == {"signal_id": "gap-1", "limit": 12}


def test_get_style_gap_stats_returns_payload(monkeypatch):
    monkeypatch.setattr(
        admin_router,
        "get_style_gap_stats_admin",
        lambda: {"open_count": 5, "covered_count": 2, "ignored_count": 1, "new_last_7d": 3, "top_open": []},
    )

    response = admin_router.get_style_gap_stats(user=_admin_user())

    assert response["success"] is True
    assert response["data"]["open_count"] == 5
