from ..database import get_db
from ..models import RedemptionCodeRecord, RedemptionCodeType


def _map_code(row) -> RedemptionCodeRecord:
    return RedemptionCodeRecord(
        id=row["id"],
        code=row["code"],
        type=row["type"],
        status=row["status"],
        created_by=row["created_by"],
        used_by=row["used_by"],
        created_at=row["created_at"],
        used_at=row["used_at"],
        expires_at=row["expires_at"],
    )


def create_redemption_code(
    code: str, code_type: RedemptionCodeType, created_by: int, expires_at: str
) -> RedemptionCodeRecord:
    db = get_db()
    cursor = db.execute(
        "INSERT INTO redemption_codes (code, type, created_by, expires_at) VALUES (?, ?, ?, ?)",
        (code, code_type, created_by, expires_at),
    )
    db.commit()
    row = db.execute(
        "SELECT * FROM redemption_codes WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return _map_code(row)


def find_code_by_code(code: str) -> RedemptionCodeRecord | None:
    db = get_db()
    row = db.execute(
        "SELECT * FROM redemption_codes WHERE code = ?", (code,)
    ).fetchone()
    return _map_code(row) if row else None


def list_codes() -> list[RedemptionCodeRecord]:
    db = get_db()
    rows = db.execute(
        "SELECT * FROM redemption_codes ORDER BY id DESC"
    ).fetchall()
    return [_map_code(r) for r in rows]


def mark_code_used(code_id: int, user_id: int) -> None:
    db = get_db()
    db.execute(
        "UPDATE redemption_codes SET status = 'used', used_by = ?, used_at = datetime('now') WHERE id = ?",
        (user_id, code_id),
    )
    db.commit()
