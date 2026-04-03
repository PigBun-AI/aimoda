from __future__ import annotations

from typing import Any

import psycopg

from ..config import settings


def _get_pg_conn():
    return psycopg.connect(settings.POSTGRES_DSN)


def _resolve_user_id(conn: psycopg.Connection, session_id: str | None, user_id: int | None) -> int | None:
    if user_id is not None or not session_id:
        return user_id

    row = conn.execute(
        "SELECT user_id FROM chat_sessions WHERE id = %s",
        (session_id,),
    ).fetchone()
    return int(row[0]) if row else None


def upsert_style_gap_signal(
    *,
    query_raw: str,
    query_normalized: str,
    session_id: str | None,
    user_id: int | None,
    source: str,
    trigger_tool: str,
    search_stage: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with _get_pg_conn() as conn:
        resolved_user_id = _resolve_user_id(conn, session_id, user_id)
        duplicate_session_event = False

        if session_id:
            row = conn.execute(
                """
                SELECT id
                FROM style_gap_events
                WHERE query_normalized = %s
                  AND session_id = %s
                  AND trigger_tool = %s
                LIMIT 1
                """,
                (query_normalized, session_id, trigger_tool),
            ).fetchone()
            duplicate_session_event = row is not None

        hit_increment = 0 if duplicate_session_event else 1
        unique_session_increment = 1 if session_id and not duplicate_session_event else 0
        initial_unique_sessions = 1 if session_id else 0

        signal = conn.execute(
            """
            INSERT INTO style_gap_signals (
                query_normalized,
                latest_query_raw,
                source,
                trigger_tool,
                search_stage,
                total_hits,
                unique_sessions,
                last_session_id,
                last_user_id,
                latest_context
            )
            VALUES (%s, %s, %s, %s, %s, 1, %s, %s, %s, %s)
            ON CONFLICT (query_normalized)
            DO UPDATE SET
                latest_query_raw = EXCLUDED.latest_query_raw,
                source = EXCLUDED.source,
                trigger_tool = EXCLUDED.trigger_tool,
                search_stage = EXCLUDED.search_stage,
                last_seen_at = NOW(),
                last_session_id = COALESCE(EXCLUDED.last_session_id, style_gap_signals.last_session_id),
                last_user_id = COALESCE(EXCLUDED.last_user_id, style_gap_signals.last_user_id),
                latest_context = CASE
                    WHEN EXCLUDED.latest_context = '{}'::jsonb THEN style_gap_signals.latest_context
                    ELSE EXCLUDED.latest_context
                END,
                total_hits = style_gap_signals.total_hits + %s,
                unique_sessions = style_gap_signals.unique_sessions + %s
            RETURNING
                id,
                query_normalized,
                latest_query_raw,
                source,
                trigger_tool,
                search_stage,
                status,
                total_hits,
                unique_sessions,
                first_seen_at,
                last_seen_at,
                latest_context
            """,
            (
                query_normalized,
                query_raw,
                source,
                trigger_tool,
                search_stage,
                initial_unique_sessions,
                session_id,
                resolved_user_id,
                psycopg.types.json.Json(context or {}),
                hit_increment,
                unique_session_increment,
            ),
        ).fetchone()

        if not duplicate_session_event:
            conn.execute(
                """
                INSERT INTO style_gap_events (
                    signal_id,
                    query_raw,
                    query_normalized,
                    session_id,
                    user_id,
                    source,
                    trigger_tool,
                    search_stage,
                    context
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    signal[0],
                    query_raw,
                    query_normalized,
                    session_id,
                    resolved_user_id,
                    source,
                    trigger_tool,
                    search_stage,
                    psycopg.types.json.Json(context or {}),
                ),
            )

        conn.commit()

    return {
        "signal_id": str(signal[0]),
        "query_normalized": signal[1],
        "latest_query_raw": signal[2],
        "source": signal[3],
        "trigger_tool": signal[4],
        "search_stage": signal[5],
        "status": signal[6],
        "total_hits": signal[7],
        "unique_sessions": signal[8],
        "first_seen_at": signal[9].isoformat() if signal[9] else None,
        "last_seen_at": signal[10].isoformat() if signal[10] else None,
        "latest_context": dict(signal[11]) if signal[11] else {},
        "recorded": not duplicate_session_event,
    }


def list_style_gap_signals(
    *,
    status: str = "open",
    q: str | None = None,
    sort: str = "total_hits",
    order: str = "desc",
    limit: int = 20,
    offset: int = 0,
    min_hits: int = 1,
) -> dict[str, Any]:
    sort_map = {
        "total_hits": "total_hits",
        "last_seen": "last_seen_at",
        "last_seen_at": "last_seen_at",
        "first_seen": "first_seen_at",
        "first_seen_at": "first_seen_at",
    }
    order_map = {"asc": "ASC", "desc": "DESC"}
    sort_column = sort_map.get(sort, "total_hits")
    order_clause = order_map.get(order.lower(), "DESC")

    where_clauses = ["status = %s", "total_hits >= %s"]
    params: list[Any] = [status, min_hits]
    count_params: list[Any] = [status, min_hits]

    query_text = " ".join((q or "").split()).strip()
    if query_text:
        where_clauses.append("(latest_query_raw ILIKE %s OR query_normalized ILIKE %s)")
        like_value = f"%{query_text}%"
        params.extend([like_value, like_value])
        count_params.extend([like_value, like_value])

    where_sql = " AND ".join(where_clauses)

    with _get_pg_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT
                id,
                query_normalized,
                latest_query_raw,
                source,
                trigger_tool,
                search_stage,
                status,
                total_hits,
                unique_sessions,
                linked_style_name,
                resolution_note,
                resolved_by,
                first_seen_at,
                last_seen_at,
                covered_at,
                latest_context
            FROM style_gap_signals
            WHERE {where_sql}
            ORDER BY {sort_column} {order_clause}, last_seen_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params + [limit, offset]),
        ).fetchall()
        count_row = conn.execute(
            f"""
            SELECT COUNT(*)::int
            FROM style_gap_signals
            WHERE {where_sql}
            """,
            tuple(count_params),
        ).fetchone()

    items = [
        {
            "id": str(row[0]),
            "query_normalized": row[1],
            "query_raw": row[2],
            "source": row[3],
            "trigger_tool": row[4],
            "search_stage": row[5],
            "status": row[6],
            "total_hits": row[7],
            "unique_sessions": row[8],
            "linked_style_name": row[9],
            "resolution_note": row[10],
            "resolved_by": row[11],
            "first_seen_at": row[12].isoformat() if row[12] else None,
            "last_seen_at": row[13].isoformat() if row[13] else None,
            "covered_at": row[14].isoformat() if row[14] else None,
            "latest_context": dict(row[15]) if row[15] else {},
        }
        for row in rows
    ]

    return {
        "items": items,
        "total": int(count_row[0]) if count_row else 0,
        "limit": limit,
        "offset": offset,
        "status": status,
        "q": query_text,
        "sort": sort_column,
        "order": order.lower(),
        "min_hits": min_hits,
    }


def update_style_gap_signal(
    *,
    signal_id: str,
    status: str,
    linked_style_name: str | None = None,
    resolution_note: str | None = None,
    resolved_by: str | None = None,
) -> dict[str, Any] | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            UPDATE style_gap_signals
            SET
                status = %s,
                covered_at = CASE
                    WHEN %s = 'covered' THEN NOW()
                    ELSE NULL
                END,
                resolved_by = CASE
                    WHEN %s = '' THEN resolved_by
                    ELSE %s
                END,
                linked_style_name = COALESCE(%s, linked_style_name),
                resolution_note = CASE
                    WHEN %s = '' THEN resolution_note
                    ELSE %s
                END
            WHERE id = %s
            RETURNING
                id,
                query_normalized,
                latest_query_raw,
                source,
                trigger_tool,
                search_stage,
                status,
                total_hits,
                unique_sessions,
                linked_style_name,
                resolution_note,
                resolved_by,
                first_seen_at,
                last_seen_at,
                covered_at,
                latest_context
            """,
            (
                status,
                status,
                (resolved_by or "").strip(),
                (resolved_by or "").strip(),
                linked_style_name,
                resolution_note or "",
                resolution_note or "",
                signal_id,
            ),
        ).fetchone()
        conn.commit()

    if not row:
        return None

    return {
        "id": str(row[0]),
        "query_normalized": row[1],
        "query_raw": row[2],
        "source": row[3],
        "trigger_tool": row[4],
        "search_stage": row[5],
        "status": row[6],
        "total_hits": row[7],
        "unique_sessions": row[8],
        "linked_style_name": row[9],
        "resolution_note": row[10],
        "resolved_by": row[11],
        "first_seen_at": row[12].isoformat() if row[12] else None,
        "last_seen_at": row[13].isoformat() if row[13] else None,
        "covered_at": row[14].isoformat() if row[14] else None,
        "latest_context": dict(row[15]) if row[15] else {},
    }


def mark_style_gap_signal_covered(
    *,
    signal_id: str | None = None,
    query_normalized: str | None = None,
    linked_style_name: str | None = None,
    resolution_note: str | None = None,
    resolved_by: str = "openclaw",
) -> dict[str, Any] | None:
    if not signal_id and not query_normalized:
        raise ValueError("Either signal_id or query_normalized is required.")

    resolved_signal_id = signal_id
    if not resolved_signal_id:
        with _get_pg_conn() as conn:
            row = conn.execute(
                """
                SELECT id
                FROM style_gap_signals
                WHERE query_normalized = %s
                LIMIT 1
                """,
                (query_normalized,),
            ).fetchone()
        if not row:
            return None
        resolved_signal_id = str(row[0])

    updated = update_style_gap_signal(
        signal_id=resolved_signal_id,
        status="covered",
        linked_style_name=linked_style_name,
        resolution_note=resolution_note,
        resolved_by=resolved_by,
    )
    if not updated:
        return None

    return {
        "signal_id": updated["id"],
        "query_normalized": updated["query_normalized"],
        "query_raw": updated["query_raw"],
        "status": updated["status"],
        "linked_style_name": updated["linked_style_name"],
        "resolution_note": updated["resolution_note"],
        "resolved_by": updated["resolved_by"],
        "covered_at": updated["covered_at"],
        "total_hits": updated["total_hits"],
        "unique_sessions": updated["unique_sessions"],
    }


def list_style_gap_events(
    *,
    signal_id: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    with _get_pg_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                id,
                query_raw,
                query_normalized,
                session_id,
                user_id,
                source,
                trigger_tool,
                search_stage,
                context,
                created_at
            FROM style_gap_events
            WHERE signal_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (signal_id, limit),
        ).fetchall()

    return [
        {
            "id": str(row[0]),
            "query_raw": row[1],
            "query_normalized": row[2],
            "session_id": str(row[3]) if row[3] else None,
            "user_id": row[4],
            "source": row[5],
            "trigger_tool": row[6],
            "search_stage": row[7],
            "context": dict(row[8]) if row[8] else {},
            "created_at": row[9].isoformat() if row[9] else None,
        }
        for row in rows
    ]


def get_style_gap_stats() -> dict[str, Any]:
    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
                COUNT(*) FILTER (WHERE status = 'covered')::int AS covered_count,
                COUNT(*) FILTER (WHERE status = 'ignored')::int AS ignored_count,
                COUNT(*) FILTER (WHERE first_seen_at >= NOW() - INTERVAL '7 days')::int AS new_last_7d
            FROM style_gap_signals
            """
        ).fetchone()

        top_rows = conn.execute(
            """
            SELECT
                id,
                latest_query_raw,
                total_hits,
                unique_sessions,
                last_seen_at
            FROM style_gap_signals
            WHERE status = 'open'
            ORDER BY total_hits DESC, last_seen_at DESC
            LIMIT 5
            """
        ).fetchall()

    return {
        "open_count": int(row[0]) if row and row[0] is not None else 0,
        "covered_count": int(row[1]) if row and row[1] is not None else 0,
        "ignored_count": int(row[2]) if row and row[2] is not None else 0,
        "new_last_7d": int(row[3]) if row and row[3] is not None else 0,
        "top_open": [
            {
                "id": str(item[0]),
                "query_raw": item[1],
                "total_hits": item[2],
                "unique_sessions": item[3],
                "last_seen_at": item[4].isoformat() if item[4] else None,
            }
            for item in top_rows
        ],
    }
