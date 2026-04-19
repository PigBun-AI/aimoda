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


def _build_report_search_clause(q: str | None, *, include_slug: bool = False) -> tuple[str, list[object]]:
    if not q or not q.strip():
        return "", []

    keyword = f"%{q.strip()}%"
    clauses = [
        "title ILIKE %s",
        "brand ILIKE %s",
        "season ILIKE %s",
        "CAST(year AS TEXT) ILIKE %s",
    ]
    params: list[object] = [keyword, keyword, keyword, keyword]

    if include_slug:
        clauses.append("slug ILIKE %s")
        params.append(keyword)

    return f"WHERE {' OR '.join(clauses)}", params


def list_reports(page: int = 1, limit: int = 12, q: str | None = None) -> tuple[list[ReportRecord], int]:
    offset = (page - 1) * limit
    where_sql, params = _build_report_search_clause(q)
    with _get_pg_conn() as conn:
        count_row = conn.execute(
            f"SELECT COUNT(*) FROM reports {where_sql}",
            params,
        ).fetchone()
        total = count_row[0] if count_row else 0
        rows = conn.execute(
            f"""
            SELECT {_REPORT_COLUMNS}
            FROM reports
            {where_sql}
            ORDER BY id DESC
            LIMIT %s OFFSET %s
            """,
            (*params, limit, offset),
        ).fetchall()
    return [_map_report(r) for r in rows], total


def list_reports_admin(page: int = 1, limit: int = 20, q: str | None = None) -> tuple[list[ReportRecord], int]:
    offset = (page - 1) * limit
    where_sql, params = _build_report_search_clause(q, include_slug=True)

    with _get_pg_conn() as conn:
        count_row = conn.execute(
            f"SELECT COUNT(*) FROM reports {where_sql}",
            params,
        ).fetchone()
        total = count_row[0] if count_row else 0
        rows = conn.execute(
            f"""
            SELECT {_REPORT_COLUMNS}
            FROM reports
            {where_sql}
            ORDER BY updated_at DESC, id DESC
            LIMIT %s OFFSET %s
            """,
            (*params, limit, offset),
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


def update_report_metadata(report_id: int, metadata_json: dict | None) -> None:
    with _get_pg_conn() as conn:
        conn.execute(
            """
            UPDATE reports
            SET metadata_json = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (
                psycopg.types.json.Json(metadata_json) if metadata_json else None,
                report_id,
            ),
        )
        conn.commit()


def update_report_admin_fields(
    report_id: int,
    *,
    title: str | None = None,
    brand: str | None = None,
    season: str | None = None,
    year: int | None = None,
    cover_url: str | None = None,
    metadata_json: dict | None = None,
) -> ReportRecord | None:
    assignments: list[str] = []
    params: list[object] = []

    if title is not None:
        assignments.append("title = %s")
        params.append(title)
    if brand is not None:
        assignments.append("brand = %s")
        params.append(brand)
    if season is not None:
        assignments.append("season = %s")
        params.append(season)
    if year is not None:
        assignments.append("year = %s")
        params.append(year)
    if cover_url is not None:
        assignments.append("cover_url = %s")
        params.append(cover_url or None)
    if metadata_json is not None:
        assignments.append("metadata_json = %s")
        params.append(psycopg.types.json.Json(metadata_json))

    if not assignments:
        return find_report_by_id(report_id)

    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            UPDATE reports
            SET {", ".join(assignments)},
                updated_at = NOW()
            WHERE id = %s
            RETURNING {_REPORT_COLUMNS}
            """,
            (*params, report_id),
        ).fetchone()
        conn.commit()

    return _map_report(row) if row else None
