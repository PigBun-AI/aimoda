import hashlib
import json

from ..database import get_db
from ..models import SessionRecord, DeviceInfo


def hash_refresh_token(token: str) -> str:
    """SHA-256 hash of refresh token."""
    return hashlib.sha256(token.encode()).hexdigest()


def _map_session(row) -> SessionRecord:
    return SessionRecord(
        id=row["id"],
        user_id=row["user_id"],
        refresh_token_hash=row["refresh_token_hash"],
        device_info=row["device_info"],
        ip_address=row["ip_address"],
        user_agent=row["user_agent"],
        last_active_at=row["last_active_at"],
        expires_at=row["expires_at"],
        created_at=row["created_at"],
    )


def create_session(
    user_id: int,
    refresh_token: str,
    device_info: DeviceInfo | None,
    ip_address: str | None,
    user_agent: str | None,
    expires_at: str,
) -> SessionRecord:
    db = get_db()
    token_hash = hash_refresh_token(refresh_token)
    device_info_json = json.dumps(device_info.model_dump()) if device_info else None
    cursor = db.execute(
        """INSERT INTO sessions (user_id, refresh_token_hash, device_info, ip_address, user_agent, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)""",
        (user_id, token_hash, device_info_json, ip_address, user_agent, expires_at),
    )
    db.commit()
    row = db.execute("SELECT * FROM sessions WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _map_session(row)


def invalidate_other_sessions(user_id: int, current_session_id: int) -> list[int]:
    db = get_db()
    rows = db.execute(
        "SELECT id FROM sessions WHERE user_id = ? AND id != ? AND expires_at > datetime('now')",
        (user_id, current_session_id),
    ).fetchall()
    revoked_session_ids = [int(row["id"]) for row in rows]
    if not revoked_session_ids:
        return []

    cursor = db.execute(
        "DELETE FROM sessions WHERE user_id = ? AND id != ?",
        (user_id, current_session_id),
    )
    db.commit()
    return revoked_session_ids if cursor.rowcount > 0 else []


def find_session_by_refresh_token(refresh_token: str) -> SessionRecord | None:
    db = get_db()
    token_hash = hash_refresh_token(refresh_token)
    row = db.execute(
        "SELECT * FROM sessions WHERE refresh_token_hash = ? AND expires_at > datetime('now')",
        (token_hash,),
    ).fetchone()
    return _map_session(row) if row else None


def find_active_sessions_by_user_id(user_id: int) -> list[SessionRecord]:
    db = get_db()
    rows = db.execute(
        """SELECT * FROM sessions
         WHERE user_id = ? AND expires_at > datetime('now')
         ORDER BY last_active_at DESC""",
        (user_id,),
    ).fetchall()
    return [_map_session(r) for r in rows]


def update_session_last_active(session_id: int) -> None:
    db = get_db()
    db.execute(
        "UPDATE sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?",
        (session_id,),
    )
    db.commit()


def update_session_token(session_id: int, refresh_token: str) -> None:
    db = get_db()
    token_hash = hash_refresh_token(refresh_token)
    db.execute(
        "UPDATE sessions SET refresh_token_hash = ? WHERE id = ?",
        (token_hash, session_id),
    )
    db.commit()


def invalidate_session_by_token(refresh_token: str) -> bool:
    db = get_db()
    token_hash = hash_refresh_token(refresh_token)
    cursor = db.execute(
        "DELETE FROM sessions WHERE refresh_token_hash = ?", (token_hash,)
    )
    db.commit()
    return cursor.rowcount > 0


def invalidate_session_by_id(session_id: int) -> bool:
    db = get_db()
    cursor = db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    db.commit()
    return cursor.rowcount > 0


def invalidate_all_user_sessions(user_id: int) -> int:
    db = get_db()
    cursor = db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    db.commit()
    return cursor.rowcount


def cleanup_expired_sessions() -> int:
    db = get_db()
    cursor = db.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    db.commit()
    return cursor.rowcount


def is_session_valid(session_id: int, user_id: int | None = None) -> bool:
    db = get_db()
    if user_id is None:
        row = db.execute(
            "SELECT id FROM sessions WHERE id = ? AND expires_at > datetime('now')",
            (session_id,),
        ).fetchone()
    else:
        row = db.execute(
            "SELECT id FROM sessions WHERE id = ? AND user_id = ? AND expires_at > datetime('now')",
            (session_id, user_id),
        ).fetchone()
    return row is not None
