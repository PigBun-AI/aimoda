import hashlib

from ..database import get_db


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def create_sms_code(
    *,
    phone: str,
    purpose: str,
    code: str,
    expires_at: str,
    ip_address: str | None,
) -> int:
    db = get_db()
    cursor = db.execute(
        """
        INSERT INTO sms_verification_codes (phone, purpose, code_hash, expires_at, ip_address)
        VALUES (?, ?, ?, ?, ?)
        """,
        (phone, purpose, hash_code(code), expires_at, ip_address),
    )
    db.commit()
    return int(cursor.lastrowid)


def get_latest_active_sms_code(phone: str, purpose: str) -> dict | None:
    db = get_db()
    row = db.execute(
        """
        SELECT *
        FROM sms_verification_codes
        WHERE phone = ? AND purpose = ? AND consumed_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (phone, purpose),
    ).fetchone()
    return dict(row) if row else None


def mark_sms_code_consumed(code_id: int) -> None:
    db = get_db()
    db.execute(
        "UPDATE sms_verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?",
        (code_id,),
    )
    db.commit()


def count_sms_codes_sent_since(phone: str, since_iso: str) -> int:
    db = get_db()
    row = db.execute(
        """
        SELECT COUNT(*)
        FROM sms_verification_codes
        WHERE phone = ? AND created_at >= ?
        """,
        (phone, since_iso),
    ).fetchone()
    return int(row[0]) if row else 0
