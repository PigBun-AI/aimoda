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
    limit: int = 20,
    offset: int = 0,
    min_hits: int = 1,
) -> dict[str, Any]:
    with _get_pg_conn() as conn:
        rows = conn.execute(
            """
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
                first_seen_at,
                last_seen_at,
                latest_context
            FROM style_gap_signals
            WHERE status = %s
              AND total_hits >= %s
            ORDER BY total_hits DESC, last_seen_at DESC
            LIMIT %s OFFSET %s
            """,
            (status, min_hits, limit, offset),
        ).fetchall()
        count_row = conn.execute(
            """
            SELECT COUNT(*)::int
            FROM style_gap_signals
            WHERE status = %s
              AND total_hits >= %s
            """,
            (status, min_hits),
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
            "first_seen_at": row[9].isoformat() if row[9] else None,
            "last_seen_at": row[10].isoformat() if row[10] else None,
            "latest_context": dict(row[11]) if row[11] else {},
        }
        for row in rows
    ]

    return {
        "items": items,
        "total": int(count_row[0]) if count_row else 0,
        "limit": limit,
        "offset": offset,
        "status": status,
        "min_hits": min_hits,
    }
