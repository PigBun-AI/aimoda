from __future__ import annotations

import re
from typing import Any

from ..repositories.style_feedback_repo import (
    get_style_gap_stats,
    list_style_gap_events,
    list_style_gap_signals,
    mark_style_gap_signal_covered,
    update_style_gap_signal,
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


def list_style_gap_feedback_admin(
    *,
    status: str = "open",
    q: str | None = None,
    min_hits: int = 1,
    sort: str = "total_hits",
    order: str = "desc",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    return list_style_gap_signals(
        status=status,
        q=(q or "").strip() or None,
        sort=sort,
        order=order,
        limit=max(1, min(limit, 100)),
        offset=max(0, offset),
        min_hits=max(1, min_hits),
    )


def update_style_gap_feedback_admin(
    *,
    signal_id: str,
    status: str,
    linked_style_name: str | None = None,
    resolution_note: str | None = None,
    resolved_by: str | None = None,
) -> dict[str, Any] | None:
    return update_style_gap_signal(
        signal_id=signal_id,
        status=status,
        linked_style_name=(linked_style_name or "").strip() or None,
        resolution_note=(resolution_note or "").strip() or None,
        resolved_by=(resolved_by or "").strip() or None,
    )


def list_style_gap_events_admin(
    *,
    signal_id: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    return list_style_gap_events(
        signal_id=signal_id,
        limit=max(1, min(limit, 100)),
    )


def get_style_gap_stats_admin() -> dict[str, Any]:
    return get_style_gap_stats()


def mark_style_gap_covered(
    *,
    signal_id: str | None = None,
    query: str | None = None,
    linked_style_name: str | None = None,
    resolution_note: str | None = None,
    resolved_by: str = "openclaw",
) -> dict[str, Any] | None:
    normalized_query = _normalize_gap_query(query or "") if query else None
    return mark_style_gap_signal_covered(
        signal_id=signal_id,
        query_normalized=normalized_query,
        linked_style_name=(linked_style_name or "").strip() or None,
        resolution_note=(resolution_note or "").strip() or None,
        resolved_by=(resolved_by or "").strip() or "openclaw",
    )
