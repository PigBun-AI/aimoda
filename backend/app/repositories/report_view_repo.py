import sqlite3

from ..database import get_db
from ..models import ReportViewRecord


def _map_view(row) -> ReportViewRecord:
    return ReportViewRecord(
        id=row["id"],
        user_id=row["user_id"],
        report_id=row["report_id"],
        viewed_at=row["viewed_at"],
    )


def record_report_view(user_id: int, report_id: int) -> bool:
    db = get_db()
    try:
        db.execute(
            "INSERT INTO report_views (user_id, report_id) VALUES (?, ?)",
            (user_id, report_id),
        )
        db.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def has_viewed_report(user_id: int, report_id: int) -> bool:
    db = get_db()
    row = db.execute(
        "SELECT 1 FROM report_views WHERE user_id = ? AND report_id = ? LIMIT 1",
        (user_id, report_id),
    ).fetchone()
    return row is not None


def get_report_view_count(user_id: int) -> int:
    db = get_db()
    row = db.execute(
        "SELECT COUNT(*) as count FROM report_views WHERE user_id = ?", (user_id,)
    ).fetchone()
    return row["count"]


def get_viewed_report_ids(user_id: int) -> list[int]:
    db = get_db()
    rows = db.execute(
        "SELECT report_id FROM report_views WHERE user_id = ? ORDER BY viewed_at DESC",
        (user_id,),
    ).fetchall()
    return [r["report_id"] for r in rows]
