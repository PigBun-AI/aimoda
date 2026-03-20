from ..database import get_db
from ..models import UserRecord, UserRole


def _map_user(row) -> UserRecord:
    return UserRecord(
        id=row["id"],
        email=row["email"],
        password_hash=row["password_hash"],
        role=row["role"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def find_user_by_email(email: str) -> UserRecord | None:
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return _map_user(row) if row else None


def find_user_by_id(user_id: int) -> UserRecord | None:
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _map_user(row) if row else None


def list_users() -> list[UserRecord]:
    db = get_db()
    rows = db.execute("SELECT * FROM users ORDER BY id ASC").fetchall()
    return [_map_user(r) for r in rows]


def count_users() -> int:
    db = get_db()
    row = db.execute("SELECT COUNT(*) as count FROM users").fetchone()
    return row["count"]


def count_users_by_role() -> dict[str, int]:
    db = get_db()
    rows = db.execute(
        "SELECT role, COUNT(*) as count FROM users GROUP BY role"
    ).fetchall()
    return {r["role"]: r["count"] for r in rows}


def create_user(email: str, password_hash: str, role: UserRole) -> UserRecord:
    db = get_db()
    cursor = db.execute(
        "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)",
        (email, password_hash, role),
    )
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _map_user(row)
