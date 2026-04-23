import pytest

from backend.app.dependencies import check_subscription_access_dep
from backend.app.exceptions import AppError
from backend.app.models import AuthenticatedUser


def test_subscription_access_allows_admin(monkeypatch):
    user = AuthenticatedUser(id=1, role="admin", email=None, phone=None, session_id=None)
    monkeypatch.setattr("backend.app.dependencies.find_active_subscription_by_user_id", lambda user_id: None)

    check_subscription_access_dep(user, "locked")


def test_subscription_access_allows_active_subscriber(monkeypatch):
    user = AuthenticatedUser(id=2, role="viewer", email=None, phone=None, session_id=None)
    monkeypatch.setattr("backend.app.dependencies.find_active_subscription_by_user_id", lambda user_id: object())

    check_subscription_access_dep(user, "locked")


def test_subscription_access_rejects_non_subscriber(monkeypatch):
    user = AuthenticatedUser(id=3, role="viewer", email=None, phone=None, session_id=None)
    monkeypatch.setattr("backend.app.dependencies.find_active_subscription_by_user_id", lambda user_id: None)

    with pytest.raises(AppError) as exc:
        check_subscription_access_dep(user, "开通会员后可查看趋势流动")

    assert exc.value.status_code == 403
    assert exc.value.detail == "开通会员后可查看趋势流动"
