from ..database import get_db
from ..models import SubscriptionRecord


def _map_subscription(row) -> SubscriptionRecord:
    return SubscriptionRecord(
        id=row["id"],
        user_id=row["user_id"],
        starts_at=row["starts_at"],
        ends_at=row["ends_at"],
        source_code_id=row["source_code_id"],
        status=row["status"],
        created_at=row["created_at"],
    )


def create_subscription(
    user_id: int, starts_at: str, ends_at: str, source_code_id: int
) -> SubscriptionRecord:
    db = get_db()
    cursor = db.execute(
        """INSERT INTO subscriptions (user_id, starts_at, ends_at, source_code_id)
         VALUES (?, ?, ?, ?)""",
        (user_id, starts_at, ends_at, source_code_id),
    )
    db.commit()
    row = db.execute(
        "SELECT * FROM subscriptions WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return _map_subscription(row)


def find_active_subscription_by_user_id(user_id: int) -> SubscriptionRecord | None:
    db = get_db()
    row = db.execute(
        """SELECT * FROM subscriptions
         WHERE user_id = ? AND status = 'active' AND ends_at > datetime('now')
         ORDER BY ends_at DESC LIMIT 1""",
        (user_id,),
    ).fetchone()
    return _map_subscription(row) if row else None


def get_subscription_stats() -> dict:
    db = get_db()
    total_row = db.execute("SELECT COUNT(*) as count FROM subscriptions").fetchone()
    active_row = db.execute(
        "SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active' AND ends_at > datetime('now')"
    ).fetchone()
    by_type_rows = db.execute(
        """SELECT rc.type, COUNT(*) as count
         FROM subscriptions s
         JOIN redemption_codes rc ON s.source_code_id = rc.id
         GROUP BY rc.type"""
    ).fetchall()
    by_type = {r["type"]: r["count"] for r in by_type_rows}
    return {"total": total_row["count"], "active": active_row["count"], "byType": by_type}
