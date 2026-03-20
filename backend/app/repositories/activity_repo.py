from ..database import get_db
from ..models import ActivityAction


def log_activity(user_id: int, action: ActivityAction) -> None:
    db = get_db()
    db.execute(
        "INSERT INTO user_activity_logs (user_id, action) VALUES (?, ?)",
        (user_id, action),
    )
    db.commit()


def get_daily_active_percent() -> float:
    db = get_db()
    active = db.execute(
        "SELECT COUNT(DISTINCT user_id) as count FROM user_activity_logs WHERE date(created_at) = date('now')"
    ).fetchone()
    total = db.execute("SELECT COUNT(*) as count FROM users").fetchone()
    if total["count"] == 0:
        return 0.0
    return round((active["count"] / total["count"]) * 10000) / 100


def get_activity_trend(days: int) -> list[dict]:
    db = get_db()
    rows = db.execute(
        """SELECT date(created_at) as date, COUNT(DISTINCT user_id) as count
         FROM user_activity_logs
         WHERE created_at >= datetime('now', ?)
         GROUP BY date(created_at)
         ORDER BY date ASC""",
        (f"-{days} days",),
    ).fetchall()
    return [{"date": r["date"], "count": r["count"]} for r in rows]
