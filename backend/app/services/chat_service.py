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
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Any

import psycopg
from langchain_core.messages import HumanMessage, SystemMessage

from ..config import settings
from ..llm_factory import build_llm_with_fallback
from ..value_normalization import normalize_quarter_value

DEFAULT_SESSION_TITLE = "新对话"
IMAGE_SEARCH_SESSION_TITLE = "图片检索"
SESSION_TITLE_MAX_LEN = 24
COMPACTION_MESSAGE_THRESHOLD = 18
COMPACTION_RECENT_MESSAGE_WINDOW = 6
TITLE_GENERATION_MAX_TOKENS = 48
DEFAULT_TASTE_PROFILE_WEIGHT = 0.24

_TITLE_PREFIX_PATTERNS = [
    re.compile(r"^(你好|您好|hi|hello|hey)[，,！!。.\s]*", re.IGNORECASE),
    re.compile(
        r"^(请问一下|请问|麻烦你|麻烦|请帮我|请你帮我|帮我|可以帮我|能不能帮我|能否帮我|"
        r"我想请你|我想让你|我想要|我想看|我想找|我想|我需要|想找|帮我找|请帮我找|"
        r"请你找|请你帮我找)[，,\s]*",
        re.IGNORECASE,
    ),
    re.compile(r"^(介绍一下|介绍下|演示一下|演示下|示范一下|示范下)[，,\s]*", re.IGNORECASE),
]
_TITLE_VERB_PREFIX_PATTERN = re.compile(r"^(找|搜|搜索|检索|查找|看看|看一下|看下)[：:\s]*", re.IGNORECASE)
_TITLE_PREFIX_LABEL_PATTERN = re.compile(r"^(标题|title)\s*[:：\-]\s*", re.IGNORECASE)
_THINK_BLOCK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_GENERIC_TITLE_VALUES = {
    "你好",
    "您好",
    "hi",
    "hello",
    "hey",
    "请问",
    "请问一下",
    "帮我",
    "请帮我",
    "我想",
    "我需要",
    DEFAULT_SESSION_TITLE,
}
_GENERIC_TITLE_PATTERNS = [
    re.compile(r"^(分析一下|分析下|介绍一下|介绍下)"),
    re.compile(r"这个(风格|款式|搭配|单品)$"),
]


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
    """Deserialize persisted ContentBlock arrays from the database."""
    if isinstance(content, list):
        return content
    return []


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _contains_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text or "")


def _compact_text(value: str) -> str:
    return " ".join((value or "").strip().split())


def _strip_title_lead_in(text: str) -> str:
    next_text = _compact_text(text)
    if not next_text:
        return ""

    previous = None
    while previous != next_text:
        previous = next_text
        for pattern in _TITLE_PREFIX_PATTERNS:
            next_text = pattern.sub("", next_text).strip()
    next_text = _TITLE_VERB_PREFIX_PATTERN.sub("", next_text).strip()
    return next_text


def _sanitize_generated_title(raw: str, *, max_length: int = SESSION_TITLE_MAX_LEN) -> str:
    cleaned = _compact_text(_strip_reasoning_markup(raw))
    if not cleaned:
        return ""

    cleaned = _TITLE_PREFIX_LABEL_PATTERN.sub("", cleaned)
    cleaned = cleaned.strip().strip("\"'“”‘’`")
    cleaned = cleaned.splitlines()[0].strip()
    cleaned = _strip_title_lead_in(cleaned) or cleaned
    cleaned = cleaned.rstrip("，,。.!！？?：:；;、/ ")
    return cleaned[:max_length].strip()


def _strip_reasoning_markup(raw: str) -> str:
    text = str(raw or "")
    if not text:
        return ""

    cleaned = _THINK_BLOCK_PATTERN.sub(" ", text)

    if re.search(r"<think>", cleaned, re.IGNORECASE):
        if not re.search(r"</think>", cleaned, re.IGNORECASE):
            return ""
        cleaned = re.split(r"</think>", cleaned, maxsplit=1, flags=re.IGNORECASE)[-1]

    cleaned = re.sub(r"</?think>", " ", cleaned, flags=re.IGNORECASE)
    return _compact_text(cleaned)


def _is_generic_title(title: str) -> bool:
    candidate = _compact_text(title)
    if not candidate:
        return True
    normalized = candidate.lower()
    if normalized in _GENERIC_TITLE_VALUES:
        return True
    if any(pattern.search(candidate) for pattern in _GENERIC_TITLE_PATTERNS):
        return True
    return len(candidate) <= 2


def _extract_first_text(blocks: list[dict] | None) -> str:
    for block in blocks or []:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        text = _compact_text(str(block.get("text", "")))
        if text:
            return text
    return ""


def _normalize_session_config(model_config: dict | None) -> dict:
    config = dict(model_config or {})
    ui = dict(config.get("ui", {}) if isinstance(config.get("ui"), dict) else {})
    runtime = dict(config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {})
    compaction = dict(runtime.get("compaction", {}) if isinstance(runtime.get("compaction"), dict) else {})
    preferences = _normalize_session_preferences(
        config.get("preferences") if isinstance(config.get("preferences"), dict) else {}
    )

    ui.setdefault("pinned", False)
    ui.setdefault("pinned_at", None)
    ui.setdefault("title_source", "default")
    ui.setdefault("title_locked", False)

    runtime.setdefault("execution_status", "idle")
    runtime.setdefault("current_run_id", None)
    runtime.setdefault("last_run_id", None)
    runtime.setdefault("last_run_started_at", None)
    runtime.setdefault("last_run_completed_at", None)
    runtime.setdefault("last_run_error", None)
    runtime.setdefault("stop_requested_at", None)
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
    config["preferences"] = preferences
    return config


def _normalize_preference_gender(value: Any) -> str | None:
    normalized = _compact_text(str(value or "")).lower()
    if not normalized:
        return None
    if normalized in {"female", "women", "woman", "womens", "女", "女装"}:
        return "female"
    if normalized in {"male", "men", "man", "mens", "男", "男装"}:
        return "male"
    return None


def _normalize_preference_quarter(value: Any) -> str | None:
    return normalize_quarter_value(value)


def _normalize_preference_year(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return year if 1900 <= year <= 2100 else None


def _normalize_preference_taste_profile_id(value: Any) -> str | None:
    normalized = _compact_text(str(value or ""))
    if not normalized:
        return None
    try:
        return _uuid(normalized)
    except Exception:
        return None


def _normalize_preference_taste_weight(value: Any) -> float:
    if value in (None, ""):
        return DEFAULT_TASTE_PROFILE_WEIGHT
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return DEFAULT_TASTE_PROFILE_WEIGHT
    return max(0.0, min(1.0, numeric))


def _normalize_session_preferences(preferences: dict | None) -> dict[str, Any]:
    payload = dict(preferences or {})
    taste_profile_id = _normalize_preference_taste_profile_id(payload.get("taste_profile_id"))
    return {
        "gender": _normalize_preference_gender(payload.get("gender")),
        "quarter": _normalize_preference_quarter(payload.get("quarter")),
        "year": _normalize_preference_year(payload.get("year")),
        "taste_profile_id": taste_profile_id,
        "taste_profile_weight": _normalize_preference_taste_weight(payload.get("taste_profile_weight")),
    }


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
        "current_run_id": runtime.get("current_run_id"),
        "last_run_id": runtime.get("last_run_id"),
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
        "preferences": dict(config.get("preferences", {}) if isinstance(config.get("preferences"), dict) else {}),
    }


def _merge_session_state(
    model_config: dict | None,
    *,
    pinned: bool | None = None,
    execution_status: str | None = None,
    run_id: str | None = None,
    error_message: str | None = None,
    preferences: dict[str, Any] | None = None,
) -> dict:
    config = _normalize_session_config(model_config)
    ui = dict(config.get("ui", {}) if isinstance(config.get("ui"), dict) else {})
    runtime = dict(config.get("runtime", {}) if isinstance(config.get("runtime"), dict) else {})
    current_preferences = dict(
        config.get("preferences", {}) if isinstance(config.get("preferences"), dict) else {}
    )

    if pinned is not None:
        ui["pinned"] = pinned
        ui["pinned_at"] = _iso_now() if pinned else None

    if execution_status is not None:
        active_run_id = str(run_id or runtime.get("current_run_id") or runtime.get("last_run_id") or uuid.uuid4())
        runtime["execution_status"] = execution_status
        if execution_status == "running":
            runtime["current_run_id"] = active_run_id
            runtime["last_run_id"] = active_run_id
            runtime["last_run_started_at"] = _iso_now()
            runtime["last_run_completed_at"] = None
            runtime["last_run_error"] = None
            runtime["stop_requested_at"] = None
        elif execution_status == "stopping":
            runtime["current_run_id"] = active_run_id
            runtime["last_run_id"] = active_run_id
            runtime["last_run_error"] = None
            runtime["stop_requested_at"] = _iso_now()
        elif execution_status in {"completed", "error"}:
            runtime["current_run_id"] = None
            runtime["last_run_id"] = active_run_id
            runtime["last_run_completed_at"] = _iso_now()
            runtime["last_run_error"] = error_message if execution_status == "error" else None
            runtime["stop_requested_at"] = None
        elif execution_status == "idle":
            runtime["current_run_id"] = None
            runtime["last_run_id"] = active_run_id
            runtime["last_run_completed_at"] = _iso_now()
            runtime["last_run_error"] = None
            runtime["stop_requested_at"] = None

    config["ui"] = ui
    config["runtime"] = runtime
    if preferences is not None:
        current_preferences.update(preferences)
    config["preferences"] = _normalize_session_preferences(current_preferences)
    return config


def _did_retrieval_preferences_change(
    previous_config: dict | None,
    next_config: dict | None,
) -> bool:
    previous = _normalize_session_config(previous_config).get("preferences", {})
    current = _normalize_session_config(next_config).get("preferences", {})
    previous_payload = _normalize_session_preferences(previous if isinstance(previous, dict) else {})
    current_payload = _normalize_session_preferences(current if isinstance(current, dict) else {})
    return previous_payload != current_payload


def _reset_runtime_after_preference_change(config: dict | None) -> dict:
    next_config = _normalize_session_config(config)
    runtime = dict(next_config.get("runtime", {}) if isinstance(next_config.get("runtime"), dict) else {})
    compaction = dict(runtime.get("compaction", {}) if isinstance(runtime.get("compaction"), dict) else {})
    current_thread_version = max(1, int(compaction.get("thread_version", 1) or 1))
    compaction["thread_version"] = current_thread_version + 1
    compaction["pending_bootstrap_thread_version"] = None
    runtime["compaction"] = compaction
    runtime["agent_state"] = {}
    next_config["runtime"] = runtime
    return next_config


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
    cleaned = _compact_text(raw)
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
            text = _sanitize_generated_title(str(block.get("text", "")))
            if text:
                text_parts.append(text)
        elif block_type == "image":
            image_count += 1

    if text_parts:
        first = text_parts[0]
        return first if not _is_generic_title(first) else _sanitize_title_text(text_parts[0])
    if image_count > 0:
        return IMAGE_SEARCH_SESSION_TITLE
    return ""


def derive_session_title_from_turn(
    user_blocks: list[dict] | None,
    assistant_blocks: list[dict] | None = None,
) -> str:
    user_title = derive_session_title_from_blocks(user_blocks)
    if user_title and not _is_generic_title(user_title):
        return user_title

    for block in assistant_blocks or []:
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue

        content = block.get("content")
        if not isinstance(content, str) or not content:
            continue

        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            payload = None

        if not isinstance(payload, dict):
            continue

        primary_style = payload.get("primary_style")
        if isinstance(primary_style, dict):
            style_name = _sanitize_generated_title(str(primary_style.get("style_name", "")), max_length=18)
            if style_name:
                return _sanitize_generated_title(f"{style_name}风格解析")

        summary = _summarize_tool_payload(payload)
        if summary:
            derived = _sanitize_generated_title(summary, max_length=18)
            if derived and not _is_generic_title(derived):
                return derived

    return user_title or ""


def _build_title_generation_llm():
    return build_llm_with_fallback(
        temperature=0,
        max_tokens=TITLE_GENERATION_MAX_TOKENS,
    )


def _extract_ai_text_content(value: Any) -> str:
    if isinstance(value, str):
        return _strip_reasoning_markup(value)
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(_strip_reasoning_markup(item))
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(_strip_reasoning_markup(item["text"]))
            else:
                text = getattr(item, "text", None)
                if isinstance(text, str):
                    parts.append(_strip_reasoning_markup(text))
        return "\n".join(part for part in parts if part)
    return _strip_reasoning_markup(str(value or ""))


def _generate_ai_session_title(
    *,
    user_blocks: list[dict] | None,
    assistant_blocks: list[dict] | None,
) -> str | None:
    if settings.ENV == "test" or not settings.LLM_API_KEY:
        return None

    user_summary = _summarize_content_blocks_for_memory(user_blocks or [])
    assistant_summary = _summarize_content_blocks_for_memory(assistant_blocks or [])
    if not user_summary and not assistant_summary:
        return None

    target_language = "中文" if _contains_cjk(f"{user_summary}{assistant_summary}") else "English"
    model = _build_title_generation_llm()
    response = model.invoke([
        SystemMessage(
            content=(
                "你是 aimoda 的会话标题生成器。"
                "请基于用户首轮需求和助手首轮结果，生成一个专业、简洁、可检索的会话标题。"
                "只输出标题本身，不要解释，不要引号，不要编号。"
                "避免问候语、请帮我、我想、示例、测试等空泛措辞。"
                "中文标题控制在 8 到 18 个字；英文标题控制在 2 到 6 个词。"
            )
        ),
        HumanMessage(
            content=(
                f"输出语言：{target_language}\n"
                f"用户首轮需求：{user_summary or '无'}\n"
                f"助手首轮结果：{assistant_summary or '无'}\n"
                "请输出一个最终会话标题。"
            )
        ),
    ])
    title = _sanitize_generated_title(_extract_ai_text_content(getattr(response, "content", "")))
    if not title or _is_generic_title(title):
        return None
    return title


def build_runtime_thread_id(user_id: int, session_id: str, thread_version: int = 1) -> str:
    return f"{user_id}:{session_id}:v{max(1, int(thread_version or 1))}"


# ── Session CRUD ──────────────────────────────────────────────────────────────


def create_session(
    user_id: int,
    title: str = DEFAULT_SESSION_TITLE,
    model_config: dict | None = None,
    preferences: dict[str, Any] | None = None,
) -> dict:
    """Create a new chat session for a user."""
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    config = _normalize_session_config(
        model_config or {"model": settings.LLM_MODEL, "temperature": settings.LLM_TEMPERATURE}
    )
    if preferences is not None:
        config = _merge_session_state(config, preferences=preferences)

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
    preferences: dict[str, Any] | None = None,
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
            preferences=preferences,
        )
        if preferences is not None and _did_retrieval_preferences_change(current_config, next_config):
            next_config = _reset_runtime_after_preference_change(next_config)
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


def reset_session_runtime_checkpoint(session_id: str) -> int | None:
    """Bump thread_version and clear volatile agent runtime after checkpoint corruption.

    This keeps persisted messages/session metadata intact while forcing LangGraph
    to resume on a fresh checkpoint thread.
    """
    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT model_config FROM chat_sessions WHERE id = %s",
            (_uuid(session_id),),
        ).fetchone()
        if not row:
            return None

        next_config = _reset_runtime_after_preference_change(
            dict(row[0]) if row[0] else {}
        )
        compaction = _session_compaction_state(next_config)
        conn.execute(
            """
            UPDATE chat_sessions
            SET model_config = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (psycopg.types.json.Json(next_config), _uuid(session_id)),
        )
        conn.commit()
        return int(compaction.get("thread_version", 1) or 1)


def set_session_execution_status(
    session_id: str,
    *,
    execution_status: str,
    run_id: str | None = None,
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
            run_id=run_id,
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
        existing_agent_state = runtime.get("agent_state", {}) if isinstance(runtime.get("agent_state"), dict) else {}
        if agent_state:
            merged_agent_state = dict(existing_agent_state)
            for key, value in dict(agent_state).items():
                if isinstance(value, dict) and isinstance(merged_agent_state.get(key), dict):
                    next_value = dict(merged_agent_state.get(key, {}))
                    next_value.update(value)
                    merged_agent_state[key] = next_value
                else:
                    merged_agent_state[key] = value
            runtime["agent_state"] = merged_agent_state
        else:
            runtime["agent_state"] = {}
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


def merge_session_agent_runtime(session_id: str, patch: dict | None) -> None:
    """Merge a partial agent runtime patch into chat_sessions.model_config.runtime."""
    if patch is None:
        return
    set_session_agent_runtime(session_id, patch)


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


def finalize_session_title(
    session_id: str,
    user_blocks: list[dict] | None,
    assistant_blocks: list[dict] | None,
) -> str | None:
    """Upgrade the provisional title after the first assistant response."""
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
        if message_count > 2:
            return current_title or None

        next_title = None
        title_source = "heuristic"

        try:
            next_title = _generate_ai_session_title(
                user_blocks=user_blocks,
                assistant_blocks=assistant_blocks,
            )
            if next_title:
                title_source = "ai"
        except Exception:
            next_title = None

        if not next_title:
            next_title = derive_session_title_from_turn(user_blocks, assistant_blocks)

        next_title = _sanitize_generated_title(next_title or "")
        if not next_title or _is_generic_title(next_title):
            return current_title or None
        if next_title == current_title and ui.get("title_source") == title_source:
            return current_title or None

        ui["title_source"] = title_source
        ui["title_locked"] = False
        config["ui"] = ui

        conn.execute(
            """
            UPDATE chat_sessions
            SET title = %s, model_config = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (next_title, psycopg.types.json.Json(config), _uuid(session_id)),
        )
        conn.commit()

    return next_title


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
    message_id: str | None = None,
) -> dict:
    """Create a new message in a session and update session counters."""
    message_id = message_id or str(uuid.uuid4())
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


def save_streaming_assistant_message(
    session_id: str,
    message_id: str,
    content: list[dict],
    *,
    metadata: dict | None = None,
) -> dict:
    """Create or update the assistant draft message for an in-flight run.

    This keeps the latest assistant output persisted independently of the client
    transport so refreshes or session switches can recover the current reply.
    """
    now = datetime.now(timezone.utc)
    meta = metadata or {}

    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT created_at
            FROM messages
            WHERE id = %s AND session_id = %s
            """,
            (_uuid(message_id), _uuid(session_id)),
        ).fetchone()

        if row:
            created_at = row[0] or now
            conn.execute(
                """
                UPDATE messages
                SET content = %s, metadata = %s
                WHERE id = %s AND session_id = %s
                """,
                (
                    psycopg.types.json.Json(content),
                    psycopg.types.json.Json(meta),
                    _uuid(message_id),
                    _uuid(session_id),
                ),
            )
        else:
            created_at = now
            conn.execute(
                """
                INSERT INTO messages (id, session_id, role, content, token_count, metadata, created_at)
                VALUES (%s, %s, 'assistant', %s, 0, %s, %s)
                """,
                (
                    _uuid(message_id),
                    _uuid(session_id),
                    psycopg.types.json.Json(content),
                    psycopg.types.json.Json(meta),
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE chat_sessions
                SET message_count = message_count + 1,
                    updated_at = %s
                WHERE id = %s
                """,
                (now, _uuid(session_id)),
            )

        conn.commit()

    return {
        "id": message_id,
        "session_id": session_id,
        "role": "assistant",
        "content": content,
        "token_count": 0,
        "metadata": meta,
        "created_at": created_at.isoformat() if created_at else now.isoformat(),
    }


def update_message(
    message_id: str,
    *,
    content: list[dict] | None = None,
    metadata_patch: dict | None = None,
) -> bool:
    """Update persisted message content/metadata without creating a new row."""
    assignments: list[str] = []
    params: list[Any] = []

    if content is not None:
        assignments.append("content = %s")
        params.append(psycopg.types.json.Json(content))

    if metadata_patch is not None:
        assignments.append("metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb")
        params.append(psycopg.types.json.Json(metadata_patch))

    if not assignments:
        return False

    params.append(_uuid(message_id))

    with _get_pg_conn() as conn:
        row = conn.execute(
            "SELECT session_id FROM messages WHERE id = %s AND deleted_at IS NULL",
            (_uuid(message_id),),
        ).fetchone()
        if not row:
            return False

        result = conn.execute(
            f"""
            UPDATE messages
            SET {", ".join(assignments)}
            WHERE id = %s
            """,
            tuple(params),
        )
        if result.rowcount > 0:
            conn.execute(
                "UPDATE chat_sessions SET updated_at = NOW() WHERE id = %s",
                (row[0],),
            )
        conn.commit()
        return result.rowcount > 0


def delete_message(message_id: str) -> bool:
    """Soft-delete a message and keep session counters consistent."""
    now = datetime.now(timezone.utc)

    with _get_pg_conn() as conn:
        row = conn.execute(
            """
            SELECT session_id, token_count
            FROM messages
            WHERE id = %s AND deleted_at IS NULL
            """,
            (_uuid(message_id),),
        ).fetchone()
        if not row:
            return False

        session_id = row[0]
        token_count = int(row[1] or 0)

        result = conn.execute(
            "UPDATE messages SET deleted_at = %s WHERE id = %s AND deleted_at IS NULL",
            (now, _uuid(message_id)),
        )
        if result.rowcount == 0:
            conn.commit()
            return False

        conn.execute(
            """
            UPDATE chat_sessions
            SET message_count = GREATEST(message_count - 1, 0),
                total_tokens = GREATEST(total_tokens - %s, 0),
                updated_at = %s
            WHERE id = %s
            """,
            (token_count, now, session_id),
        )
        conn.commit()
        return True


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
            INNER JOIN chat_sessions s ON m.session_id::text = s.id::text
            WHERE m.session_id::text = %s AND s.user_id = %s AND m.deleted_at IS NULL {role_filter}
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
