"""PostgreSQL-backed CRUD helpers for trend-flow records."""

from __future__ import annotations

import json

import psycopg

from ..config import settings
from ..models import TrendFlowRecord


TREND_FLOW_COLUMNS = """
    id, slug, title, brand, start_quarter, start_year, end_quarter, end_year,
    index_url, overview_url, cover_url, oss_prefix,
    uploaded_by, timeline_json, metadata_json, lead_excerpt, created_at, updated_at
"""


def _get_pg_conn():
    return psycopg.connect(settings.POSTGRES_DSN)


def _json_or_none(value) -> str | None:
    return json.dumps(value) if value is not None else None


def _map_trend_flow(row) -> TrendFlowRecord:
    return TrendFlowRecord(
        id=row[0],
        slug=row[1],
        title=row[2],
        brand=row[3],
        start_quarter=row[4],
        start_year=row[5],
        end_quarter=row[6],
        end_year=row[7],
        index_url=row[8],
        overview_url=row[9],
        cover_url=row[10],
        oss_prefix=row[11],
        uploaded_by=row[12],
        timeline_json=_json_or_none(row[13]),
        metadata_json=_json_or_none(row[14]),
        lead_excerpt=row[15],
        created_at=row[16].isoformat() if row[16] else "",
        updated_at=row[17].isoformat() if row[17] else "",
    )


def find_trend_flow_by_slug(slug: str) -> TrendFlowRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"SELECT {TREND_FLOW_COLUMNS} FROM trend_flows WHERE slug = %s",
            (slug,),
        ).fetchone()
    return _map_trend_flow(row) if row else None


def find_trend_flow_by_id(trend_flow_id: int) -> TrendFlowRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"SELECT {TREND_FLOW_COLUMNS} FROM trend_flows WHERE id = %s",
            (trend_flow_id,),
        ).fetchone()
    return _map_trend_flow(row) if row else None


def _build_trend_flow_search_clause(q: str | None) -> tuple[str, list[object]]:
    if not q or not q.strip():
        return "", []

    keyword = f"%{q.strip()}%"
    clauses = [
        "title ILIKE %s",
        "brand ILIKE %s",
        "start_quarter ILIKE %s",
        "end_quarter ILIKE %s",
        "CAST(start_year AS TEXT) ILIKE %s",
        "CAST(end_year AS TEXT) ILIKE %s",
        "timeline_json::text ILIKE %s",
        "slug ILIKE %s",
    ]
    params: list[object] = [keyword] * len(clauses)
    return f"WHERE {' OR '.join(clauses)}", params


def list_trend_flows(page: int = 1, limit: int = 12, q: str | None = None) -> tuple[list[TrendFlowRecord], int]:
    offset = (page - 1) * limit
    where_sql, params = _build_trend_flow_search_clause(q)
    with _get_pg_conn() as conn:
        count_row = conn.execute(
            f"SELECT COUNT(*) FROM trend_flows {where_sql}",
            params,
        ).fetchone()
        total = count_row[0] if count_row else 0
        rows = conn.execute(
            f"""
            SELECT {TREND_FLOW_COLUMNS}
            FROM trend_flows
            {where_sql}
            ORDER BY start_year DESC, end_year DESC, id DESC
            LIMIT %s OFFSET %s
            """,
            (*params, limit, offset),
        ).fetchall()
    return [_map_trend_flow(row) for row in rows], total


def update_trend_flow_admin_fields(
    trend_flow_id: int,
    *,
    title: str | None = None,
    brand: str | None = None,
    start_quarter: str | None = None,
    start_year: int | None = None,
    end_quarter: str | None = None,
    end_year: int | None = None,
    cover_url: str | None = None,
    timeline_json: list[dict] | None = None,
    metadata_json: dict | None = None,
) -> TrendFlowRecord | None:
    assignments: list[str] = []
    params: list[object] = []

    if title is not None:
        assignments.append("title = %s")
        params.append(title)
    if brand is not None:
        assignments.append("brand = %s")
        params.append(brand)
    if start_quarter is not None:
        assignments.append("start_quarter = %s")
        params.append(start_quarter)
    if start_year is not None:
        assignments.append("start_year = %s")
        params.append(start_year)
    if end_quarter is not None:
        assignments.append("end_quarter = %s")
        params.append(end_quarter)
    if end_year is not None:
        assignments.append("end_year = %s")
        params.append(end_year)
    if cover_url is not None:
        assignments.append("cover_url = %s")
        params.append(cover_url or None)
    if timeline_json is not None:
        assignments.append("timeline_json = %s")
        params.append(psycopg.types.json.Json(timeline_json))
    if metadata_json is not None:
        assignments.append("metadata_json = %s")
        params.append(psycopg.types.json.Json(metadata_json))

    if not assignments:
        return find_trend_flow_by_id(trend_flow_id)

    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            UPDATE trend_flows
            SET {", ".join(assignments)},
                updated_at = NOW()
            WHERE id = %s
            RETURNING {TREND_FLOW_COLUMNS}
            """,
            (*params, trend_flow_id),
        ).fetchone()
        conn.commit()

    return _map_trend_flow(row) if row else None


def delete_trend_flow(trend_flow_id: int) -> bool:
    with _get_pg_conn() as conn:
        result = conn.execute("DELETE FROM trend_flows WHERE id = %s", (trend_flow_id,))
        conn.commit()
        return result.rowcount > 0


def create_trend_flow(
    *,
    slug: str,
    title: str,
    brand: str,
    start_quarter: str,
    start_year: int,
    end_quarter: str,
    end_year: int,
    index_url: str,
    overview_url: str | None,
    cover_url: str | None,
    oss_prefix: str,
    uploaded_by: int,
    timeline_json: list[dict] | None,
    metadata_json: dict | None,
    lead_excerpt: str | None,
) -> TrendFlowRecord:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            INSERT INTO trend_flows
                (slug, title, brand, start_quarter, start_year, end_quarter, end_year,
                 index_url, overview_url, cover_url, oss_prefix,
                 uploaded_by, timeline_json, metadata_json, lead_excerpt)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {TREND_FLOW_COLUMNS}
            """,
            (
                slug,
                title,
                brand,
                start_quarter,
                start_year,
                end_quarter,
                end_year,
                index_url,
                overview_url,
                cover_url,
                oss_prefix,
                uploaded_by,
                psycopg.types.json.Json(timeline_json) if timeline_json is not None else None,
                psycopg.types.json.Json(metadata_json) if metadata_json is not None else None,
                lead_excerpt,
            ),
        ).fetchone()
        conn.commit()
    return _map_trend_flow(row)
