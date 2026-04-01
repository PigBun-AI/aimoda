"""
Report View Repository — PostgreSQL-backed view tracking.

Migrated from SQLite to PostgreSQL (shared fashion_chat database).
"""

import psycopg

from ..config import settings
from ..models import ReportViewRecord


def _get_pg_conn():
    """Get a PostgreSQL connection."""
    return psycopg.connect(settings.POSTGRES_DSN)


def record_report_view(user_id: int, report_id: int) -> bool:
    """Record that a user viewed a report. Returns False if already viewed."""
    try:
        with _get_pg_conn() as conn:
            conn.execute(
                "INSERT INTO report_views (user_id, report_id) VALUES (%s, %s)",
                (user_id, report_id),
            )
            conn.commit()
            return True
    except psycopg.errors.UniqueViolation:
        return False


def has_viewed_report(user_id: int, report_id: int) -> bool:
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM report_views WHERE user_id = %s AND report_id = %s LIMIT 1",
            (user_id, report_id),
        ).fetchone()
    return row is not None


def get_report_view_count(user_id: int) -> int:
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM report_views WHERE user_id = %s",
            (user_id,),
        ).fetchone()
    return row[0] if row else 0


def get_viewed_report_ids(user_id: int) -> list[int]:
    with _get_pg_conn() as conn:
        rows = conn.execute(
            "SELECT report_id FROM report_views WHERE user_id = %s ORDER BY viewed_at DESC",
            (user_id,),
        ).fetchall()
    return [r[0] for r in rows]
