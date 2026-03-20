import re

import bcrypt

from ..exceptions import AppError
from ..models import SafeUser
from ..repositories.user_repo import find_user_by_email, create_user, list_users

_PASSWORD_RE = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$")


def _validate_password(password: str) -> None:
    if not _PASSWORD_RE.match(password):
        raise AppError("密码必须至少8位，包含大小写字母和数字", 400)


def _to_safe_user(user) -> SafeUser:
    return SafeUser(
        id=user.id,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def register_user(email: str, password: str, role: str) -> SafeUser:
    if find_user_by_email(email):
        raise AppError("邮箱已存在", 400)

    _validate_password(password)
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user = create_user(email=email, password_hash=password_hash, role=role)
    return _to_safe_user(user)


def get_users() -> list[SafeUser]:
    return [_to_safe_user(u) for u in list_users()]
