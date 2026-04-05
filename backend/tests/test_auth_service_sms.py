from backend.app.exceptions import AppError
from backend.app.services import auth_service


def test_send_sms_code_returns_debug_code_in_mock_mode(monkeypatch):
    monkeypatch.setattr(auth_service.settings, "SMS_PROVIDER", "mock")
    monkeypatch.setattr(auth_service, "get_latest_active_sms_code", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_service, "count_sms_codes_sent_since", lambda *args, **kwargs: 0)
    monkeypatch.setattr(auth_service, "send_verification_sms", lambda *args, **kwargs: {"provider": "mock"})

    created = {}

    def _fake_create_sms_code(**kwargs):
        created.update(kwargs)
        return 1

    monkeypatch.setattr(auth_service, "create_sms_code", _fake_create_sms_code)

    payload = auth_service.send_sms_code("13800138000", purpose="register", ip_address="127.0.0.1")

    assert payload["phone"] == "13800138000"
    assert payload["purpose"] == "register"
    assert payload["debugCode"] == auth_service.settings.SMS_MOCK_CODE
    assert created["phone"] == "13800138000"
    assert created["purpose"] == "register"


def test_login_or_register_by_phone_reuses_existing_session_logic(monkeypatch):
    monkeypatch.setattr(
        auth_service,
        "get_latest_active_sms_code",
        lambda *args, **kwargs: {
            "id": 1,
            "code_hash": auth_service.hash_code(auth_service.settings.SMS_MOCK_CODE),
            "expires_at": "2999-01-01T00:00:00+00:00",
        },
    )
    monkeypatch.setattr(auth_service, "mark_sms_code_consumed", lambda code_id: None)
    monkeypatch.setattr(auth_service, "find_user_by_phone", lambda phone: None)

    created = {}

    class User:
        id = 7
        email = None
        phone = "13800138000"
        role = "viewer"
        created_at = "2026-01-01T00:00:00+00:00"
        updated_at = "2026-01-01T00:00:00+00:00"

    def _fake_create_user(**kwargs):
        created.update(kwargs)
        return User()

    monkeypatch.setattr(auth_service, "create_user", _fake_create_user)
    monkeypatch.setattr(auth_service, "log_activity", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        auth_service,
        "login_with_session",
        lambda user, **kwargs: {
            "tokens": {"accessToken": "a", "refreshToken": "b"},
            "session": None,
            "kicked_other_devices": False,
        },
    )

    result = auth_service.login_or_register_by_phone("13800138000", auth_service.settings.SMS_MOCK_CODE)

    assert created["phone"] == "13800138000"
    assert result["user"].phone == "13800138000"


def test_login_or_register_by_phone_rejects_wrong_code(monkeypatch):
    monkeypatch.setattr(
        auth_service,
        "get_latest_active_sms_code",
        lambda *args, **kwargs: {
            "id": 1,
            "code_hash": auth_service.hash_code("999999"),
            "expires_at": "2999-01-01T00:00:00+00:00",
        },
    )

    try:
        auth_service.login_or_register_by_phone("13800138000", "000000")
    except AppError as exc:
        assert exc.status_code == 400
        assert exc.message == "验证码错误"
    else:
        raise AssertionError("Expected AppError for invalid SMS code")


def test_register_by_phone_rejects_existing_phone(monkeypatch):
    monkeypatch.setattr(
        auth_service,
        "get_latest_active_sms_code",
        lambda *args, **kwargs: {
            "id": 1,
            "code_hash": auth_service.hash_code(auth_service.settings.SMS_MOCK_CODE),
            "expires_at": "2999-01-01T00:00:00+00:00",
        },
    )
    monkeypatch.setattr(auth_service, "mark_sms_code_consumed", lambda code_id: None)
    monkeypatch.setattr(auth_service, "find_user_by_phone", lambda phone: object())

    try:
        auth_service.register_by_phone("13800138000", auth_service.settings.SMS_MOCK_CODE)
    except AppError as exc:
        assert exc.status_code == 409
        assert exc.message == "手机号已被注册"
    else:
        raise AssertionError("Expected AppError for existing phone")


def test_send_sms_code_translates_gateway_errors(monkeypatch):
    monkeypatch.setattr(auth_service, "get_latest_active_sms_code", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_service, "count_sms_codes_sent_since", lambda *args, **kwargs: 0)

    def _raise(*args, **kwargs):
        raise auth_service.SmsGatewayError("provider down")

    monkeypatch.setattr(auth_service, "send_verification_sms", _raise)

    try:
        auth_service.send_sms_code("13800138000", purpose="login")
    except AppError as exc:
        assert exc.status_code == 500
        assert exc.message == "短信发送失败: provider down"
    else:
        raise AssertionError("Expected AppError for SMS provider failures")


def test_send_sms_code_handles_naive_created_at_cooldown(monkeypatch):
    monkeypatch.setattr(
        auth_service,
        "get_latest_active_sms_code",
        lambda *args, **kwargs: {"created_at": "2099-01-01 00:00:00"},
    )

    try:
        auth_service.send_sms_code("13800138000", purpose="login")
    except AppError as exc:
        assert exc.status_code == 429
        assert "验证码发送过于频繁" in exc.message
    else:
        raise AssertionError("Expected cooldown AppError for naive timestamps")
