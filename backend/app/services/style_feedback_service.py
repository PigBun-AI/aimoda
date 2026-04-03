from __future__ import annotations

import re
from typing import Any

from ..repositories.style_feedback_repo import (
    list_style_gap_signals,
    upsert_style_gap_signal,
)


def _normalize_gap_query(query: str) -> str:
    normalized = " ".join((query or "").strip().split()).lower()
    normalized = normalized.replace("_", " ").replace("-", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def record_style_gap_feedback(
    *,
    query: str,
    session_id: str | None = None,
    user_id: int | None = None,
    thread_id: str | None = None,
    trigger_tool: str = "search_style",
    search_stage: str = "not_found",
    source: str = "agent_auto",
    fallback_suggestion: str | None = None,
    extra_context: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    query_raw = " ".join((query or "").strip().split())
    query_normalized = _normalize_gap_query(query_raw)
    if not query_normalized:
        return None

    context = {
        "thread_id": thread_id,
        "fallback_suggestion": fallback_suggestion or "",
        **(extra_context or {}),
    }
    context = {key: value for key, value in context.items() if value not in (None, "", [], {})}

    return upsert_style_gap_signal(
        query_raw=query_raw,
        query_normalized=query_normalized,
        session_id=session_id,
        user_id=user_id,
        source=source,
        trigger_tool=trigger_tool,
        search_stage=search_stage,
        context=context,
    )


def get_open_style_gap_feedback(
    *,
    limit: int = 20,
    offset: int = 0,
    min_hits: int = 1,
) -> dict[str, Any]:
    return list_style_gap_signals(
        status="open",
        limit=max(1, min(limit, 100)),
        offset=max(0, offset),
        min_hits=max(1, min_hits),
    )
