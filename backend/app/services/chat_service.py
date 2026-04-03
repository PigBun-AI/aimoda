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
from typing import Optional, Any

import psycopg

from ..config import settings

DEFAULT_SESSION_TITLE = "新对话"
IMAGE_SEARCH_SESSION_TITLE = "图片检索"
SESSION_TITLE_MAX_LEN = 24
COMPACTION_MESSAGE_THRESHOLD = 18
COMPACTION_RECENT_MESSAGE_WINDOW = 6


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


def _normalize_session_config(model_config: dict | None) -> dict:
    config = dict(model_config or {})
    ui = dict(config.get("ui", {}) if isinstance(config.get("ui"), dict) else {})
    runtime = dict(config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {})
    compaction = dict(runtime.get("compaction", {}) if isinstance(runtime.get("compaction"), dict) else {})

    ui.setdefault("pinned", False)
    ui.setdefault("pinned_at", None)
    ui.setdefault("title_source", "default")
    ui.setdefault("title_locked", False)

    runtime.setdefault("execution_status", "idle")
    runtime.setdefault("last_run_started_at", None)
    runtime.setdefault("last_run_completed_at", None)
    runtime.setdefault("last_run_error", None)
    runtime.setdefault("agent_state", {})

    compaction["thread_version"] = max(1, int(compaction.get("thread_version", 1) or 1))
    compaction["active_summary_version"] = max(0, int(compaction.get("active_summary_version", 0) or 0))
    compaction["compacted_message_count"] = max(0, int(compaction.get("compacted_message_count", 0) or 0))
    pending_bootstrap = compaction.get("pending_bootstrap_thread_version")
    compaction["pending_bootstrap_thread_version"] = (
        max(1, int(pending_bootstrap))
        if pending_bootstrap not in (None, "", 0)
        else None
    )
    compaction.setdefault("last_compacted_at", None)
    compaction.setdefault("recent_message_window", COMPACTION_RECENT_MESSAGE_WINDOW)

    runtime["compaction"] = compaction
    config["ui"] = ui
    config["runtime"] = runtime
    return config


def _session_ui_state(model_config: dict | None) -> dict:
    config = _normalize_session_config(model_config)
    ui = config.get("ui", {}) if isinstance(config.get("ui"), dict) else {}
    runtime = config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {}
    return {
        "is_pinned": bool(ui.get("pinned", False)),
        "pinned_at": ui.get("pinned_at"),
        "title_source": str(ui.get("title_source", "default") or "default"),
        "title_locked": bool(ui.get("title_locked", False)),
        "execution_status": runtime.get("execution_status", "idle"),
        "last_run_started_at": runtime.get("last_run_started_at"),
        "last_run_completed_at": runtime.get("last_run_completed_at"),
        "last_run_error": runtime.get("last_run_error"),
        "thread_version": max(
            1,
            int(
                (runtime.get("compaction", {}) if isinstance(runtime.get("compaction"), dict) else {}).get(
                    "thread_version",
                    1,
                )
                or 1
            ),
        ),
        "active_summary_version": max(
            0,
            int(
                (runtime.get("compaction", {}) if isinstance(runtime.get("compaction"), dict) else {}).get(
                    "active_summary_version",
                    0,
                )
                or 0
            ),
        ),
    }


def _merge_session_state(
    model_config: dict | None,
    *,
    pinned: bool | None = None,
    execution_status: str | None = None,
    error_message: str | None = None,
) -> dict:
    config = _normalize_session_config(model_config)
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


def _session_compaction_state(model_config: dict | None) -> dict[str, Any]:
    config = _normalize_session_config(model_config)
    runtime = config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {}
    compaction = runtime.get("compaction", {}) if isinstance(runtime.get("compaction"), dict) else {}
    return {
        "thread_version": max(1, int(compaction.get("thread_version", 1) or 1)),
        "active_summary_version": max(0, int(compaction.get("active_summary_version", 0) or 0)),
        "compacted_message_count": max(0, int(compaction.get("compacted_message_count", 0) or 0)),
        "pending_bootstrap_thread_version": (
            max(1, int(compaction["pending_bootstrap_thread_version"]))
            if compaction.get("pending_bootstrap_thread_version") not in (None, "", 0)
            else None
        ),
        "last_compacted_at": compaction.get("last_compacted_at"),
        "recent_message_window": max(
            1,
            int(compaction.get("recent_message_window", COMPACTION_RECENT_MESSAGE_WINDOW) or COMPACTION_RECENT_MESSAGE_WINDOW),
        ),
    }


def _serialize_session(
    *,
    session_id: str,
    user_id: int,
    title: str,
    status: str,
    model_config: dict | None,
    message_count: int,
    total_tokens: int,
    created_at: datetime | None,
    updated_at: datetime | None,
) -> dict[str, Any]:
    config = _normalize_session_config(model_config)
    return {
        "id": session_id,
        "user_id": user_id,
        "title": title,
        "status": status,
        "model_config": config,
        **_session_ui_state(config),
        "message_count": message_count,
        "total_tokens": total_tokens,
        "created_at": created_at.isoformat() if created_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def _sanitize_title_text(raw: str, *, max_length: int = SESSION_TITLE_MAX_LEN) -> str:
    cleaned = " ".join((raw or "").strip().split())
    if not cleaned:
        return ""
    return cleaned[:max_length]


def derive_session_title_from_blocks(blocks: list[dict] | None) -> str:
    blocks = blocks or []
    text_parts: list[str] = []
    image_count = 0

    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            text = _sanitize_title_text(str(block.get("text", "")))
            if text:
                text_parts.append(text)
        elif block_type == "image":
            image_count += 1

    if text_parts:
        return _sanitize_title_text(text_parts[0])
    if image_count > 0:
        return IMAGE_SEARCH_SESSION_TITLE
    return ""


def build_runtime_thread_id(user_id: int, session_id: str, thread_version: int = 1) -> str:
    return f"{user_id}:{session_id}:v{max(1, int(thread_version or 1))}"


# ── Session CRUD ──────────────────────────────────────────────────────────────


def create_session(
    user_id: int,
    title: str = DEFAULT_SESSION_TITLE,
    model_config: dict | None = None,
) -> dict:
    """Create a new chat session for a user."""
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    config = _normalize_session_config(
        model_config or {"model": settings.LLM_MODEL, "temperature": settings.LLM_TEMPERATURE}
    )

    with _get_pg_conn() as conn:
        conn.execute(
            """
            INSERT INTO chat_sessions (id, user_id, title, model_config, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (_uuid(session_id), user_id, title, psycopg.types.json.Json(config), now, now),
        )
        conn.commit()

    return _serialize_session(
        session_id=session_id,
        user_id=user_id,
        title=title,
        status="active",
        model_config=config,
        message_count=0,
        total_tokens=0,
        created_at=now,
        updated_at=now,
    )


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
        _serialize_session(
            session_id=r[0],
            user_id=r[1],
            title=r[2],
            status=r[3],
            model_config=dict(r[4]) if r[4] else {},
            message_count=r[5],
            total_tokens=r[6],
            created_at=r[7],
            updated_at=r[8],
        )
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

    return _serialize_session(
        session_id=row[0],
        user_id=row[1],
        title=row[2],
        status=row[3],
        model_config=dict(row[4]) if row[4] else {},
        message_count=row[5],
        total_tokens=row[6],
        created_at=row[7],
        updated_at=row[8],
    )


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

        current_config = _normalize_session_config(dict(row[1]) if row[1] else {})
        next_title = title if title is not None else row[0]
        next_config = _merge_session_state(
            current_config,
            pinned=pinned,
        )
        if title is not None:
            ui = dict(next_config.get("ui", {}) if isinstance(next_config.get("ui"), dict) else {})
            ui["title_source"] = "manual"
            ui["title_locked"] = True
            next_config["ui"] = ui

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
            _normalize_session_config(dict(row[0]) if row[0] else {}),
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


def get_session_agent_runtime(session_id: str) -> dict:
    """Return persisted agent runtime state for a chat session."""
    session = get_session(session_id)
    if not session:
        return {}
    config = _normalize_session_config(session.get("model_config", {}) if isinstance(session, dict) else {})
    runtime = config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {}
    agent_state = runtime.get("agent_state", {}) if isinstance(runtime.get("agent_state"), dict) else {}
    return dict(agent_state)


def set_session_agent_runtime(session_id: str, agent_state: dict | None) -> None:
    """Persist serializable agent runtime state into chat_sessions.model_config.runtime."""
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT model_config FROM chat_sessions WHERE id = %s",
            (_uuid(session_id),),
        ).fetchone()
        if not row:
            return

        config = _normalize_session_config(dict(row[0]) if row[0] else {})
        runtime = dict(config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {})
        runtime["agent_state"] = dict(agent_state or {})
        config["runtime"] = runtime

        conn.execute(
            """
            UPDATE chat_sessions
            SET model_config = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (psycopg.types.json.Json(config), _uuid(session_id)),
        )
        conn.commit()


def auto_title_session(session_id: str, content_blocks: list[dict] | None) -> str | None:
    """Auto-set a session title from the first turn unless the user locked it manually."""
    title = derive_session_title_from_blocks(content_blocks)
    if not title:
        return None

    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT title, message_count, model_config
            FROM chat_sessions
            WHERE id = %s
            """,
            (_uuid(session_id),),
        ).fetchone()
        if not row:
            return None

        current_title = str(row[0] or "")
        message_count = int(row[1] or 0)
        config = _normalize_session_config(dict(row[2]) if row[2] else {})
        ui = dict(config.get("ui", {}) if isinstance(config.get("ui"), dict) else {})

        if ui.get("title_locked"):
            return current_title or None
        if message_count != 0:
            return current_title or None

        ui["title_source"] = "heuristic"
        ui["title_locked"] = False
        config["ui"] = ui

        conn.execute(
            """
            UPDATE chat_sessions
            SET title = %s, model_config = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (title, psycopg.types.json.Json(config), _uuid(session_id)),
        )
        conn.commit()
    return title


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


def _summarize_tool_payload(payload: dict[str, Any]) -> str:
    action = str(payload.get("action", "")).strip()
    if action == "show_collection":
        total = payload.get("total", 0)
        filters = payload.get("filters_applied", [])
        filters_text = ", ".join(str(item) for item in filters[:4]) if isinstance(filters, list) else ""
        return f"展示检索结果 {total} 张" + (f"，过滤条件：{filters_text}" if filters_text else "")

    primary_style = payload.get("primary_style")
    if isinstance(primary_style, dict) and primary_style.get("style_name"):
        style_name = str(primary_style.get("style_name", "")).strip()
        retrieval_plan = payload.get("retrieval_plan", {})
        query_en = ""
        if isinstance(retrieval_plan, dict):
            query_en = str(retrieval_plan.get("retrieval_query_en", "")).strip()
        return f"识别核心风格 {style_name}" + (f"，英文检索词：{query_en}" if query_en else "")

    analysis = payload.get("analysis")
    if isinstance(analysis, dict):
        summary = str(analysis.get("summary_zh", "")).strip()
        query_en = str(analysis.get("retrieval_query_en", "")).strip()
        if summary or query_en:
            return f"视觉分析：{summary}" + (f"；英文检索词：{query_en}" if query_en else "")

    message = str(payload.get("message", "")).strip()
    if message:
        return message

    status = str(payload.get("status", "")).strip()
    if status:
        return f"工具返回状态：{status}"

    return ""


def _summarize_content_blocks_for_memory(blocks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    image_count = 0
    document_count = 0

    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            text = _sanitize_title_text(str(block.get("text", "")), max_length=120)
            if text:
                parts.append(text)
        elif block_type == "image":
            image_count += 1
        elif block_type == "document":
            document_count += 1
        elif block_type == "tool_result":
            content = block.get("content")
            if isinstance(content, str) and content:
                try:
                    payload = json.loads(content)
                except json.JSONDecodeError:
                    payload = None
                if isinstance(payload, dict):
                    tool_summary = _summarize_tool_payload(payload)
                    if tool_summary:
                        parts.append(tool_summary)

    if image_count > 0:
        parts.append(f"用户上传图片 {image_count} 张")
    if document_count > 0:
        parts.append(f"用户上传文件 {document_count} 个")

    summary = "；".join(part for part in parts if part)
    return _sanitize_title_text(summary, max_length=220)


def _build_compaction_summary(
    *,
    title: str,
    messages: list[dict[str, Any]],
    runtime_state: dict[str, Any] | None,
) -> str:
    lines: list[str] = ["[SESSION_MEMORY_SUMMARY]"]
    if title:
        lines.append(f"当前会话标题：{title}")

    runtime = dict(runtime_state or {})
    search_session = runtime.get("search_session") if isinstance(runtime.get("search_session"), dict) else {}
    semantics = runtime.get("semantics") if isinstance(runtime.get("semantics"), dict) else {}

    if search_session:
        query = str(search_session.get("query", "")).strip()
        if query:
            lines.append(f"当前检索主查询：{query}")
        filters = search_session.get("filters", [])
        if isinstance(filters, list) and filters:
            filter_bits = []
            for item in filters[:8]:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "category":
                    filter_bits.append(f"category={item.get('value', '')}")
                else:
                    key = str(item.get("key", "")).strip()
                    value = str(item.get("value", "")).strip()
                    if key and value:
                        filter_bits.append(f"{key}={value}")
            if filter_bits:
                lines.append("当前硬过滤条件：" + "，".join(filter_bits))

    primary_style = str(semantics.get("primary_style_name", "")).strip()
    if primary_style:
        lines.append(f"当前主风格：{primary_style}")
    style_query = str(semantics.get("style_retrieval_query", "")).strip()
    if style_query:
        lines.append(f"风格英文检索词：{style_query}")

    lines.append("历史轮次摘要：")
    for idx, message in enumerate(messages[-24:], start=1):
        role = "用户" if message.get("role") == "user" else "助手"
        content_summary = _summarize_content_blocks_for_memory(message.get("content", []))
        if not content_summary:
            continue
        lines.append(f"{idx}. {role}：{content_summary}")

    lines.append("[/SESSION_MEMORY_SUMMARY]")
    return "\n".join(lines)


def _apply_compaction_state_update(
    session_id: str,
    *,
    thread_version: int,
    active_summary_version: int,
    compacted_message_count: int,
    pending_bootstrap_thread_version: int | None,
) -> None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT model_config FROM chat_sessions WHERE id = %s",
            (_uuid(session_id),),
        ).fetchone()
        if not row:
            return

        config = _normalize_session_config(dict(row[0]) if row[0] else {})
        runtime = dict(config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {})
        compaction = dict(runtime.get("compaction", {}) if isinstance(runtime.get("compaction"), dict) else {})
        compaction.update({
            "thread_version": max(1, int(thread_version or 1)),
            "active_summary_version": max(0, int(active_summary_version or 0)),
            "compacted_message_count": max(0, int(compacted_message_count or 0)),
            "pending_bootstrap_thread_version": (
                max(1, int(pending_bootstrap_thread_version))
                if pending_bootstrap_thread_version is not None
                else None
            ),
            "last_compacted_at": _iso_now(),
            "recent_message_window": COMPACTION_RECENT_MESSAGE_WINDOW,
        })
        runtime["compaction"] = compaction
        config["runtime"] = runtime
        conn.execute(
            "UPDATE chat_sessions SET model_config = %s, updated_at = NOW() WHERE id = %s",
            (psycopg.types.json.Json(config), _uuid(session_id)),
        )
        conn.commit()


def maybe_compact_session(session_id: str, user_id: int) -> dict[str, Any] | None:
    session = get_session(session_id)
    if not session:
        return None

    compaction = _session_compaction_state(session.get("model_config", {}))
    total_messages = int(session.get("message_count", 0) or 0)
    recent_window = max(1, int(compaction.get("recent_message_window", COMPACTION_RECENT_MESSAGE_WINDOW) or COMPACTION_RECENT_MESSAGE_WINDOW))

    if total_messages < COMPACTION_MESSAGE_THRESHOLD:
        return None

    range_end = total_messages - recent_window
    if range_end <= 0 or range_end <= int(compaction.get("compacted_message_count", 0) or 0):
        return None

    messages = list_messages(session_id, user_id, limit=max(total_messages, 1), offset=0, include_system=False)
    messages_to_compact = messages[:range_end]
    if not messages_to_compact:
        return None

    summary_text = _build_compaction_summary(
        title=str(session.get("title", "")),
        messages=messages_to_compact,
        runtime_state=get_session_agent_runtime(session_id),
    )
    summary = save_context_summary(
        session_id=session_id,
        summary=summary_text,
        token_count=max(1, len(summary_text) // 4),
        range_start=1,
        range_end=range_end,
    )

    next_thread_version = max(1, int(compaction.get("thread_version", 1) or 1)) + 1
    _apply_compaction_state_update(
        session_id,
        thread_version=next_thread_version,
        active_summary_version=int(summary["version"]),
        compacted_message_count=range_end,
        pending_bootstrap_thread_version=next_thread_version,
    )

    return {
        "thread_version": next_thread_version,
        "summary_version": summary["version"],
        "range_end": range_end,
    }


def get_compaction_bootstrap_payload(
    session_id: str,
    user_id: int,
    *,
    thread_version: int,
) -> dict[str, Any] | None:
    session = get_session(session_id)
    if not session:
        return None

    compaction = _session_compaction_state(session.get("model_config", {}))
    if compaction.get("pending_bootstrap_thread_version") != thread_version:
        return None

    active_summary_version = int(compaction.get("active_summary_version", 0) or 0)
    summary = get_summary_by_version(session_id, active_summary_version) if active_summary_version > 0 else get_latest_summary(session_id)
    if not summary:
        return None

    messages = list_messages(
        session_id,
        user_id,
        limit=max(int(session.get("message_count", 0) or 0), 1),
        offset=0,
        include_system=False,
    )
    recent_messages = messages[int(summary.get("range_end", 0) or 0):]
    return {
        "summary": summary,
        "recent_messages": recent_messages,
    }


def clear_compaction_bootstrap(session_id: str, *, thread_version: int) -> None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT model_config FROM chat_sessions WHERE id = %s",
            (_uuid(session_id),),
        ).fetchone()
        if not row:
            return

        config = _normalize_session_config(dict(row[0]) if row[0] else {})
        runtime = dict(config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {})
        compaction = dict(runtime.get("compaction", {}) if isinstance(runtime.get("compaction"), dict) else {})
        if compaction.get("pending_bootstrap_thread_version") != thread_version:
            return

        compaction["pending_bootstrap_thread_version"] = None
        runtime["compaction"] = compaction
        config["runtime"] = runtime

        conn.execute(
            "UPDATE chat_sessions SET model_config = %s, updated_at = NOW() WHERE id = %s",
            (psycopg.types.json.Json(config), _uuid(session_id)),
        )
        conn.commit()


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


def get_summary_by_version(session_id: str, version: int) -> dict | None:
    """Get a specific context summary version for a session."""
    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT id, session_id, summary, token_count, range_start, range_end, version, created_at
            FROM session_context_summaries
            WHERE session_id = %s AND version = %s
            LIMIT 1
            """,
            (session_id, version),
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

def get_thread_id(user_id: int, session_id: str, thread_version: int = 1) -> str:
    """Build a LangGraph thread_id from user_id, session_id, and thread version."""
    return build_runtime_thread_id(user_id, session_id, thread_version)
