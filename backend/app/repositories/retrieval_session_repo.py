from __future__ import annotations

import uuid
from typing import Any

import psycopg

from ..config import settings


_STATUS_VALUES = {"active", "archived", "closed"}
_SOURCE_VALUES = {"langgraph", "mcp"}


def _get_pg_conn():
    return psycopg.connect(settings.POSTGRES_DSN)


def _uuid(value: str | uuid.UUID) -> str:
    if isinstance(value, uuid.UUID):
        return str(value)
    return str(uuid.UUID(str(value)))


def _normalize_json_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _normalize_json_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _serialize_row(row) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "actor_type": str(row[1] or "user"),
        "actor_id": str(row[2] or ""),
        "user_id": int(row[3]) if row[3] is not None else None,
        "chat_session_id": str(row[4]) if row[4] else None,
        "source": str(row[5]),
        "status": str(row[6]),
        "query": str(row[7] or ""),
        "vector_type": str(row[8] or "fashion_clip"),
        "q_emb": _normalize_json_list(row[9]),
        "active_filters": _normalize_json_list(row[10]),
        "search_artifact_ref": str(row[11]) if row[11] else None,
        "metadata": _normalize_json_dict(row[12]),
        "created_at": row[13].isoformat() if row[13] else None,
        "updated_at": row[14].isoformat() if row[14] else None,
    }


def create_retrieval_session(
    *,
    actor_type: str,
    actor_id: str,
    user_id: int | None,
    chat_session_id: str | None,
    source: str,
    status: str = "active",
    query: str = "",
    vector_type: str = "fashion_clip",
    q_emb: list[float] | None = None,
    active_filters: list[dict[str, Any]] | None = None,
    search_artifact_ref: str | None = None,
    metadata: dict[str, Any] | None = None,
    retrieval_session_id: str | None = None,
) -> dict[str, Any]:
    source = source if source in _SOURCE_VALUES else "langgraph"
    status = status if status in _STATUS_VALUES else "active"
    next_id = retrieval_session_id or str(uuid.uuid4())
    normalized_actor_type = "agent" if actor_type == "agent" else "user"
    normalized_actor_id = str(actor_id).strip()
    if not normalized_actor_id:
        raise ValueError("actor_id is required for retrieval sessions")

    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            INSERT INTO retrieval_sessions (
                id, actor_type, actor_id, user_id, chat_session_id, source, status, query, vector_type,
                q_emb, active_filters, search_artifact_ref, metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, actor_type, actor_id, user_id, chat_session_id, source, status, query, vector_type,
                      q_emb, active_filters, search_artifact_ref, metadata, created_at, updated_at
            """,
            (
                _uuid(next_id),
                normalized_actor_type,
                normalized_actor_id,
                int(user_id) if user_id is not None else None,
                _uuid(chat_session_id) if chat_session_id else None,
                source,
                status,
                query,
                vector_type,
                psycopg.types.json.Json(q_emb or []),
                psycopg.types.json.Json(active_filters or []),
                search_artifact_ref,
                psycopg.types.json.Json(metadata or {}),
            ),
        ).fetchone()
        conn.commit()

    return _serialize_row(row)


def get_retrieval_session(retrieval_session_id: str) -> dict[str, Any] | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT id, actor_type, actor_id, user_id, chat_session_id, source, status, query, vector_type,
                   q_emb, active_filters, search_artifact_ref, metadata, created_at, updated_at
            FROM retrieval_sessions
            WHERE id = %s
            """,
            (_uuid(retrieval_session_id),),
        ).fetchone()

    if not row:
        return None
    return _serialize_row(row)


def update_retrieval_session(
    retrieval_session_id: str,
    *,
    query: str | None = None,
    vector_type: str | None = None,
    q_emb: list[float] | None = None,
    active_filters: list[dict[str, Any]] | None = None,
    search_artifact_ref: str | None = None,
    status: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    assignments: list[str] = []
    params: list[Any] = []

    if query is not None:
        assignments.append("query = %s")
        params.append(query)
    if vector_type is not None:
        assignments.append("vector_type = %s")
        params.append(vector_type)
    if q_emb is not None:
        assignments.append("q_emb = %s")
        params.append(psycopg.types.json.Json(q_emb))
    if active_filters is not None:
        assignments.append("active_filters = %s")
        params.append(psycopg.types.json.Json(active_filters))
    if search_artifact_ref is not None:
        assignments.append("search_artifact_ref = %s")
        params.append(search_artifact_ref)
    if status is not None:
        assignments.append("status = %s")
        params.append(status if status in _STATUS_VALUES else "active")
    if metadata is not None:
        assignments.append("metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb")
        params.append(psycopg.types.json.Json(metadata))

    if not assignments:
        return get_retrieval_session(retrieval_session_id)

    assignments.append("updated_at = NOW()")
    params.append(_uuid(retrieval_session_id))

    sql = f"""
        UPDATE retrieval_sessions
        SET {', '.join(assignments)}
        WHERE id = %s
        RETURNING id, actor_type, actor_id, user_id, chat_session_id, source, status, query, vector_type,
                  q_emb, active_filters, search_artifact_ref, metadata, created_at, updated_at
    """

    with _get_pg_conn() as conn:
        row = conn.execute(sql, tuple(params)).fetchone()
        conn.commit()

    if not row:
        return None
    return _serialize_row(row)


def replace_retrieval_session_filters(
    retrieval_session_id: str,
    *,
    filters: list[dict[str, Any]],
) -> None:
    with _get_pg_conn() as conn:
        conn.execute(
            "DELETE FROM retrieval_session_filters WHERE retrieval_session_id = %s",
            (_uuid(retrieval_session_id),),
        )
        for index, filter_entry in enumerate(filters):
            conn.execute(
                """
                INSERT INTO retrieval_session_filters (
                    retrieval_session_id,
                    dimension,
                    category,
                    filter_key,
                    filter_type,
                    filter_field,
                    value_json,
                    sort_order
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    _uuid(retrieval_session_id),
                    str(filter_entry.get("dimension") or filter_entry.get("key") or ""),
                    filter_entry.get("category"),
                    str(filter_entry.get("key") or ""),
                    str(filter_entry.get("type") or ""),
                    filter_entry.get("field"),
                    psycopg.types.json.Json(filter_entry),
                    index,
                ),
            )
        conn.commit()


def list_retrieval_session_filters(retrieval_session_id: str) -> list[dict[str, Any]]:
    with _get_pg_conn() as conn:
        rows = conn.execute(
            """
            SELECT value_json
            FROM retrieval_session_filters
            WHERE retrieval_session_id = %s
            ORDER BY sort_order ASC, created_at ASC, id ASC
            """,
            (_uuid(retrieval_session_id),),
        ).fetchall()

    return [dict(row[0]) for row in rows if isinstance(row[0], dict)]
