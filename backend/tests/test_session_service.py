from backend.app.services import session_service
from backend.app.models import SafeUser


def test_login_with_session_returns_revoked_session_ids_for_non_admin(monkeypatch):
    safe_user = SafeUser(
        id=9,
        email="user@example.com",
        phone=None,
        role="viewer",
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
    )

    class _Session:
        id = 12

    monkeypatch.setattr(session_service, "parse_device_info", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(session_service, "get_refresh_token_expiry", lambda: "2099-01-01T00:00:00+00:00")
    monkeypatch.setattr(session_service, "create_session", lambda **_kwargs: _Session())
    monkeypatch.setattr(
        session_service,
        "issue_tokens",
        lambda *_args, **_kwargs: type("Tokens", (), {"refreshToken": "refresh-token"})(),
    )
    monkeypatch.setattr(session_service, "update_session_token", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(session_service, "invalidate_other_sessions", lambda *_args, **_kwargs: [3, 4])

    result = session_service.login_with_session(safe_user, user_agent="ua", ip_address="127.0.0.1")

    assert result["kicked_other_devices"] is True
    assert result["revoked_session_ids"] == [3, 4]
