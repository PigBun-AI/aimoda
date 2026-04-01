"""
Chat Service — manages agent invocation and session CRUD with PostgreSQL.

Schema (see sql/chat_schema.sql):
  - chat_sessions: Session metadata (title, status, model_config, tokens)
  - messages: Individual chat messages (role, content, token_count, metadata)
  - artifacts: Tool outputs / long-running task results
  - session_context_summaries: Sliding window summaries

Conversation state is also persisted by LangGraph's checkpointer
(AsyncPostgresSaver) in separate checkpoint tables.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import psycopg

from ..config import settings


def _get_pg_conn():
    """Get a PostgreSQL connection."""
    return psycopg.connect(settings.POSTGRES_DSN)


def _uuid(val: str) -> str:
    """Normalize a UUID string for PostgreSQL queries.

    Chat identifiers are stored as UUID in PostgreSQL. This helper validates the
    format and returns a string psycopg can adapt correctly.
    """
    if isinstance(val, uuid.UUID):
        return str(val)
    # Validate format
    uuid.UUID(val)
    return val


def _deserialize_content(content) -> list[dict]:
    """Deserialize message content from the database.

    New format: JSONB array of ContentBlocks, e.g. [{"type": "text", "text": "..."}]
    Old format: plain string (TEXT content from pre-migration data)

    For backward compatibility, old TEXT content is returned as [{"type": "text", "text": "<original>"}].
    If the content is already a list (JSONB), deserialize it; otherwise fall back to the old format.
    """
    if isinstance(content, list):
        return content
    if isinstance(content, str):
        # Try parsing as JSON array first (new ContentBlock format stored as TEXT)
        if content.startswith("["):
            try:
                parsed = json.loads(content)
                if isinstance(parsed, list):
                    return parsed
            except (json.JSONDecodeError, ValueError):
                pass
        # Old plain TEXT content — wrap in ContentBlock format
        return [{"type": "text", "text": content}] if content else []
    # Unknown type — return empty array
    return []


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _session_ui_state(model_config: dict | None) -> dict:
    config = model_config or {}
    ui = config.get("ui", {}) if isinstance(config.get("ui"), dict) else {}
    runtime = config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {}
    return {
        "is_pinned": bool(ui.get("pinned", False)),
        "pinned_at": ui.get("pinned_at"),
        "execution_status": runtime.get("execution_status", "idle"),
        "last_run_started_at": runtime.get("last_run_started_at"),
        "last_run_completed_at": runtime.get("last_run_completed_at"),
        "last_run_error": runtime.get("last_run_error"),
    }


def _merge_session_state(
    model_config: dict | None,
    *,
    pinned: bool | None = None,
    execution_status: str | None = None,
    error_message: str | None = None,
) -> dict:
    config = dict(model_config or {})
    ui = dict(config.get("ui", {}) if isinstance(config.get("ui"), dict) else {})
    runtime = dict(config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {})

    if pinned is not None:
        ui["pinned"] = pinned
        ui["pinned_at"] = _iso_now() if pinned else None

    if execution_status is not None:
        runtime["execution_status"] = execution_status
        if execution_status == "running":
            runtime["last_run_started_at"] = _iso_now()
            runtime["last_run_error"] = None
        elif execution_status in {"completed", "error"}:
            runtime["last_run_completed_at"] = _iso_now()
            runtime["last_run_error"] = error_message if execution_status == "error" else None

    config["ui"] = ui
    config["runtime"] = runtime
    return config


# ── Session CRUD ──────────────────────────────────────────────────────────────


def create_session(
    user_id: int,
    title: str = "新对话",
    model_config: dict | None = None,
) -> dict:
    """Create a new chat session for a user."""
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    config = model_config or {"model": settings.LLM_MODEL, "temperature": settings.LLM_TEMPERATURE}

    with _get_pg_conn() as conn:
        conn.execute(
            """
            INSERT INTO chat_sessions (id, user_id, title, model_config, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (_uuid(session_id), user_id, title, psycopg.types.json.Json(config), now, now),
        )
        conn.commit()

    return {
        "id": session_id,
        "user_id": user_id,
        "title": title,
        "model_config": config,
        "status": "active",
        "is_pinned": False,
        "pinned_at": None,
        "execution_status": "idle",
        "last_run_started_at": None,
        "last_run_completed_at": None,
        "last_run_error": None,
        "message_count": 0,
        "total_tokens": 0,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }


def list_sessions(
    user_id: int,
    status: str = "active",
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List chat sessions for a user, ordered by pin then most recent first."""
    with _get_pg_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, title, status, model_config,
                   message_count, total_tokens, created_at, updated_at
            FROM chat_sessions
            WHERE user_id = %s AND status = %s
            ORDER BY
              COALESCE((model_config->'ui'->>'pinned')::boolean, FALSE) DESC,
              COALESCE((model_config->'ui'->>'pinned_at')::timestamptz, to_timestamp(0)) DESC,
              updated_at DESC
            LIMIT %s OFFSET %s
            """,
            (user_id, status, limit, offset),
        ).fetchall()

    return [
        {
            "id": r[0],
            "user_id": r[1],
            "title": r[2],
            "status": r[3],
            "model_config": dict(r[4]) if r[4] else {},
            **_session_ui_state(dict(r[4]) if r[4] else {}),
            "message_count": r[5],
            "total_tokens": r[6],
            "created_at": r[7].isoformat() if r[7] else None,
            "updated_at": r[8].isoformat() if r[8] else None,
        }
        for r in rows
    ]


def get_session(session_id: str) -> dict | None:
    """Get a single session by ID."""
    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT id, user_id, title, status, model_config,
                   message_count, total_tokens, created_at, updated_at
            FROM chat_sessions WHERE id = %s
            """,
            (_uuid(session_id),),
        ).fetchone()

    if not row:
        return None

    config = dict(row[4]) if row[4] else {}
    return {
        "id": row[0],
        "user_id": row[1],
        "title": row[2],
        "status": row[3],
        "model_config": config,
        **_session_ui_state(config),
        "message_count": row[5],
        "total_tokens": row[6],
        "created_at": row[7].isoformat() if row[7] else None,
        "updated_at": row[8].isoformat() if row[8] else None,
    }


def update_session_title(session_id: str, user_id: int, title: str) -> bool:
    """Update a session's title. Returns True if updated."""
    with _get_pg_conn() as conn:
        result = conn.execute(
            """
            UPDATE chat_sessions SET title = %s, updated_at = NOW()
            WHERE id = %s AND user_id = %s AND status != 'deleted'
            """,
            (title, _uuid(session_id), user_id),
        )
        conn.commit()
        return result.rowcount > 0


def update_session_preferences(
    session_id: str,
    user_id: int,
    *,
    title: str | None = None,
    pinned: bool | None = None,
) -> dict | None:
    """Update mutable session preferences and return the updated session."""
    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT title, model_config
            FROM chat_sessions
            WHERE id = %s AND user_id = %s AND status != 'deleted'
            """,
            (_uuid(session_id), user_id),
        ).fetchone()
        if not row:
            return None

        next_title = title if title is not None else row[0]
        next_config = _merge_session_state(
            dict(row[1]) if row[1] else {},
            pinned=pinned,
        )

        conn.execute(
            """
            UPDATE chat_sessions
            SET title = %s, model_config = %s, updated_at = NOW()
            WHERE id = %s AND user_id = %s AND status != 'deleted'
            """,
            (
                next_title,
                psycopg.types.json.Json(next_config),
                _uuid(session_id),
                user_id,
            ),
        )
        conn.commit()

    return get_session(session_id)


def touch_session(session_id: str):
    """Update the session's updated_at timestamp."""
    with _get_pg_conn() as conn:
        conn.execute(
            "UPDATE chat_sessions SET updated_at = NOW() WHERE id = %s",
            (_uuid(session_id),),
        )
        conn.commit()


def set_session_execution_status(
    session_id: str,
    *,
    execution_status: str,
    error_message: str | None = None,
) -> None:
    """Persist runtime execution state for a session."""
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT model_config FROM chat_sessions WHERE id = %s",
            (_uuid(session_id),),
        ).fetchone()
        if not row:
            return

        next_config = _merge_session_state(
            dict(row[0]) if row[0] else {},
            execution_status=execution_status,
            error_message=error_message,
        )
        conn.execute(
            """
            UPDATE chat_sessions
            SET model_config = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (psycopg.types.json.Json(next_config), _uuid(session_id)),
        )
        conn.commit()


def auto_title_session(session_id: str, user_message: str):
    """Auto-set session title from first user message (max 20 chars).

    Only updates the title if the session currently has 0 messages
    (i.e., this is the first message in the session).
    """
    title = user_message.strip()[:20]
    if not title:
        return
    with _get_pg_conn() as conn:
        conn.execute(
            """
            UPDATE chat_sessions SET title = %s, updated_at = NOW()
            WHERE id = %s AND message_count = 0
            """,
            (title, _uuid(session_id)),
        )
        conn.commit()


def delete_session(session_id: str, user_id: int) -> bool:
    """Soft-delete a session. Returns True if deleted."""
    with _get_pg_conn() as conn:
        result = conn.execute(
            """
            UPDATE chat_sessions SET status = 'deleted', deleted_at = NOW()
            WHERE id = %s AND user_id = %s
            """,
            (_uuid(session_id), user_id),
        )
        conn.commit()
        return result.rowcount > 0


def archive_session(session_id: str, user_id: int) -> bool:
    """Archive a session (soft-delete variant)."""
    with _get_pg_conn() as conn:
        result = conn.execute(
            """
            UPDATE chat_sessions SET status = 'archived', updated_at = NOW()
            WHERE id = %s AND user_id = %s AND status = 'active'
            """,
            (_uuid(session_id), user_id),
        )
        conn.commit()
        return result.rowcount > 0


# ── Message CRUD ──────────────────────────────────────────────────────────────


def create_message(
    session_id: str,
    role: str,
    content: list[dict],
    token_count: int = 0,
    metadata: dict | None = None,
) -> dict:
    """Create a new message in a session and update session counters."""
    message_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    meta = metadata or {}

    with _get_pg_conn() as conn:
        conn.execute(
            """
            INSERT INTO messages (id, session_id, role, content, token_count, metadata, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                _uuid(message_id), _uuid(session_id), role, psycopg.types.json.Json(content), token_count,
                psycopg.types.json.Json(meta), now,
            ),
        )
        # Update session counters
        conn.execute(
            """
            UPDATE chat_sessions
            SET message_count = message_count + 1,
                total_tokens = total_tokens + %s,
                updated_at = %s
            WHERE id = %s
            """,
            (token_count, now, _uuid(session_id)),
        )
        conn.commit()

    return {
        "id": message_id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "token_count": token_count,
        "metadata": meta,
        "created_at": now.isoformat(),
    }


def list_messages(
    session_id: str,
    user_id: int,
    limit: int = 100,
    offset: int = 0,
    include_system: bool = True,
) -> list[dict]:
    """List messages in a session, newest last (chronological order)."""
    role_filter = "" if include_system else "AND role != 'system'"
    with _get_pg_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT m.id, m.session_id, m.role, m.content, m.token_count, m.metadata, m.created_at
            FROM messages m
            INNER JOIN chat_sessions s ON m.session_id = s.id
            WHERE m.session_id = %s AND s.user_id = %s AND m.deleted_at IS NULL {role_filter}
            ORDER BY m.created_at ASC
            LIMIT %s OFFSET %s
            """,
            (_uuid(session_id), user_id, limit, offset),
        ).fetchall()

    return [
        {
            "id": r[0],
            "session_id": r[1],
            "role": r[2],
            "content": _deserialize_content(r[3]),
            "token_count": r[4],
            "metadata": dict(r[5]) if r[5] else {},
            "created_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


def get_session_token_count(session_id: str) -> int:
    """Get total token count for a session (cached)."""
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT total_tokens FROM chat_sessions WHERE id = %s",
            (_uuid(session_id),),
        ).fetchone()
    return row[0] if row else 0


def get_message_count(session_id: str) -> int:
    """Get message count for a session (cached)."""
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT message_count FROM chat_sessions WHERE id = %s",
            (_uuid(session_id),),
        ).fetchone()
    return row[0] if row else 0


# ── Artifact CRUD ──────────────────────────────────────────────────────────────


def create_artifact(
    session_id: str,
    artifact_type: str,
    storage_type: str = "s3",
    storage_path: str = "",
    content: str | None = None,
    metadata: dict | None = None,
    message_id: str | None = None,
    is_permanent: bool = False,
    expires_at: datetime | None = None,
) -> dict:
    """Create an artifact from a tool call or async generation."""
    artifact_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    meta = metadata or {}

    with _get_pg_conn() as conn:
        conn.execute(
            """
            INSERT INTO artifacts
              (id, message_id, session_id, artifact_type, storage_type, storage_path,
               content, metadata, is_permanent, expires_at, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                artifact_id, message_id, session_id, artifact_type, storage_type,
                storage_path, content, psycopg.types.json.Json(meta),
                is_permanent, expires_at, now,
            ),
        )
        conn.commit()

    return {
        "id": artifact_id,
        "message_id": message_id,
        "session_id": session_id,
        "artifact_type": artifact_type,
        "storage_type": storage_type,
        "storage_path": storage_path,
        "content": content,
        "metadata": meta,
        "is_permanent": is_permanent,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "created_at": now.isoformat(),
    }


def list_artifacts(
    session_id: str,
    artifact_type: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """List artifacts for a session."""
    type_filter = "AND artifact_type = %s" if artifact_type else ""
    params = (session_id,) + ((artifact_type,) if artifact_type else ()) + (limit,)

    with _get_pg_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT id, message_id, session_id, artifact_type, storage_type,
                   storage_path, content, metadata, is_permanent, expires_at, created_at
            FROM artifacts
            WHERE session_id = %s AND deleted_at IS NULL {type_filter}
            ORDER BY created_at DESC
            LIMIT %s
            """,
            params,
        ).fetchall()

    return [
        {
            "id": r[0],
            "message_id": r[1],
            "session_id": r[2],
            "artifact_type": r[3],
            "storage_type": r[4],
            "storage_path": r[5],
            "content": r[6],
            "metadata": dict(r[7]) if r[7] else {},
            "is_permanent": r[8],
            "expires_at": r[9].isoformat() if r[9] else None,
            "created_at": r[10].isoformat() if r[10] else None,
        }
        for r in rows
    ]


def get_artifact(
    artifact_id: str,
    *,
    session_id: str | None = None,
    artifact_type: str | None = None,
) -> dict | None:
    """Fetch a single artifact by id with optional session/type guards."""
    clauses = ["id = %s", "deleted_at IS NULL"]
    params: list[object] = [_uuid(artifact_id)]

    if session_id is not None:
        clauses.append("session_id = %s")
        params.append(_uuid(session_id))
    if artifact_type is not None:
        clauses.append("artifact_type = %s")
        params.append(artifact_type)

    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            SELECT id, message_id, session_id, artifact_type, storage_type,
                   storage_path, content, metadata, is_permanent, expires_at, created_at
            FROM artifacts
            WHERE {' AND '.join(clauses)}
            LIMIT 1
            """,
            params,
        ).fetchone()

    if not row:
        return None

    return {
        "id": row[0],
        "message_id": row[1],
        "session_id": row[2],
        "artifact_type": row[3],
        "storage_type": row[4],
        "storage_path": row[5],
        "content": row[6],
        "metadata": dict(row[7]) if row[7] else {},
        "is_permanent": row[8],
        "expires_at": row[9].isoformat() if row[9] else None,
        "created_at": row[10].isoformat() if row[10] else None,
    }


# ── Context Summary CRUD ──────────────────────────────────────────────────────


def save_context_summary(
    session_id: str,
    summary: str,
    token_count: int,
    range_start: int,
    range_end: int,
) -> dict:
    """Save a new context summary for a session. Creates a new version."""
    summary_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with _get_pg_conn() as conn:
        # Get next version number
        row = conn.execute(
            "SELECT COALESCE(MAX(version), 0) FROM session_context_summaries WHERE session_id = %s",
            (session_id,),
        ).fetchone()
        next_version = (row[0] or 0) + 1

        conn.execute(
            """
            INSERT INTO session_context_summaries
              (id, session_id, summary, token_count, range_start, range_end, version, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (summary_id, session_id, summary, token_count, range_start, range_end, next_version, now),
        )
        conn.commit()

    return {
        "id": summary_id,
        "session_id": session_id,
        "summary": summary,
        "token_count": token_count,
        "range_start": range_start,
        "range_end": range_end,
        "version": next_version,
        "created_at": now.isoformat(),
    }


def get_latest_summary(session_id: str) -> dict | None:
    """Get the most recent context summary for a session."""
    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT id, session_id, summary, token_count, range_start, range_end, version, created_at
            FROM session_context_summaries
            WHERE session_id = %s
            ORDER BY version DESC
            LIMIT 1
            """,
            (session_id,),
        ).fetchone()

    if not row:
        return None

    return {
        "id": row[0],
        "session_id": row[1],
        "summary": row[2],
        "token_count": row[3],
        "range_start": row[4],
        "range_end": row[5],
        "version": row[6],
        "created_at": row[7].isoformat() if row[7] else None,
    }


# ── Thread ID helper (for LangGraph) ─────────────────────────────────────────

def get_thread_id(user_id: int, session_id: str) -> str:
    """Build a LangGraph thread_id from user_id and session_id."""
    return f"{user_id}:{session_id}"
