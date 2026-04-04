"""
Report Repository — PostgreSQL-backed CRUD for reports.

Migrated from SQLite to PostgreSQL (shared fashion_chat database).
Uses psycopg v3 (same pattern as chat_service.py).
"""

import json

import psycopg

from ..config import settings
from ..models import ReportRecord


def _get_pg_conn():
    """Get a PostgreSQL connection."""
    return psycopg.connect(settings.POSTGRES_DSN)


def _map_report(row) -> ReportRecord:
    """Map a psycopg Row to ReportRecord."""
    return ReportRecord(
        id=row[0],
        slug=row[1],
        title=row[2],
        brand=row[3],
        season=row[4],
        year=row[5],
        look_count=row[6],
        index_url=row[7],
        overview_url=row[8],
        cover_url=row[9],
        oss_prefix=row[10],
        uploaded_by=row[11],
        metadata_json=json.dumps(row[12]) if row[12] else None,
        created_at=row[13].isoformat() if row[13] else "",
        updated_at=row[14].isoformat() if row[14] else "",
    )


_REPORT_COLUMNS = """
    id, slug, title, brand, season, year, look_count,
    index_url, overview_url, cover_url, oss_prefix,
    uploaded_by, metadata_json, created_at, updated_at
"""


def find_report_by_slug(slug: str) -> ReportRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"SELECT {_REPORT_COLUMNS} FROM reports WHERE slug = %s",
            (slug,),
        ).fetchone()
    return _map_report(row) if row else None


def find_report_by_id(report_id: int) -> ReportRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"SELECT {_REPORT_COLUMNS} FROM reports WHERE id = %s",
            (report_id,),
        ).fetchone()
    return _map_report(row) if row else None


def list_reports(page: int = 1, limit: int = 12) -> tuple[list[ReportRecord], int]:
    offset = (page - 1) * limit
    with _get_pg_conn() as conn:
        count_row = conn.execute("SELECT COUNT(*) FROM reports").fetchone()
        total = count_row[0] if count_row else 0
        rows = conn.execute(
            f"SELECT {_REPORT_COLUMNS} FROM reports ORDER BY id DESC LIMIT %s OFFSET %s",
            (limit, offset),
        ).fetchall()
    return [_map_report(r) for r in rows], total


def delete_report_by_id(report_id: int) -> bool:
    with _get_pg_conn() as conn:
        result = conn.execute("DELETE FROM reports WHERE id = %s", (report_id,))
        conn.commit()
        return result.rowcount > 0


def create_report(
    slug: str,
    title: str,
    brand: str,
    season: str,
    year: int,
    look_count: int,
    index_url: str,
    overview_url: str | None,
    cover_url: str | None,
    oss_prefix: str,
    uploaded_by: int,
    metadata_json: dict | None,
) -> ReportRecord:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            INSERT INTO reports
                (slug, title, brand, season, year, look_count,
                 index_url, overview_url, cover_url, oss_prefix,
                 uploaded_by, metadata_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {_REPORT_COLUMNS}
            """,
            (
                slug, title, brand, season, year, look_count,
                index_url, overview_url, cover_url, oss_prefix,
                uploaded_by,
                psycopg.types.json.Json(metadata_json) if metadata_json else None,
            ),
        ).fetchone()
        conn.commit()
    return _map_report(row)


def list_all_reports() -> list[ReportRecord]:
    with _get_pg_conn() as conn:
        rows = conn.execute(
            f"SELECT {_REPORT_COLUMNS} FROM reports ORDER BY id DESC",
        ).fetchall()
    return [_map_report(r) for r in rows]


def update_report_cover_url(report_id: int, cover_url: str | None) -> ReportRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            UPDATE reports
            SET cover_url = %s,
                updated_at = NOW()
            WHERE id = %s
            RETURNING {_REPORT_COLUMNS}
            """,
            (cover_url, report_id),
        ).fetchone()
        conn.commit()
    return _map_report(row) if row else None
