from backend.app.models import AuthenticatedUser
from backend.app.services import feature_access_service as service


def test_free_user_ai_chat_lifetime_limit(monkeypatch):
    monkeypatch.setattr(service, "_is_paid_user", lambda user_id: False)
    monkeypatch.setattr(service, "get_feature_usage", lambda *args, **kwargs: None)

    status = service.get_feature_access_status(
        AuthenticatedUser(id=1, email="free@example.com", role="viewer"),
        "ai_chat",
    )

    assert status.allowed is True
    assert status.limit_count == service.FREE_CHAT_LIFETIME_LIMIT
    assert status.remaining_count == service.FREE_CHAT_LIFETIME_LIMIT


def test_paid_user_ai_chat_daily_limit_exceeded(monkeypatch):
    monkeypatch.setattr(service, "_is_paid_user", lambda user_id: True)

    class Usage:
        used_count = service.PAID_CHAT_DAILY_LIMIT

    monkeypatch.setattr(service, "get_feature_usage", lambda *args, **kwargs: Usage())

    status = service.get_feature_access_status(
        AuthenticatedUser(id=2, email="paid@example.com", role="viewer"),
        "ai_chat",
    )

    assert status.allowed is False
    assert status.reason == "limit_exceeded"
    assert status.remaining_count == 0


def test_fashion_reports_require_subscription_for_viewer(monkeypatch):
    monkeypatch.setattr(service, "_is_paid_user", lambda user_id: False)

    status = service.get_feature_access_status(
        AuthenticatedUser(id=3, email="viewer@example.com", role="viewer"),
        "fashion_reports",
    )

    assert status.allowed is False
    assert status.reason == "subscription_required"
