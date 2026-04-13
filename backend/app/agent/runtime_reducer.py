"""
Reducer for turning raw tool results into a compact execution state.

This is the runtime equivalent of a thick harness memory layer: rather than
asking the model to re-interpret every previous tool payload, we compress the
latest tool outcomes into a stable state snapshot that can be persisted and
reused on the next turn.
"""

from __future__ import annotations

import json
from typing import Any, TypedDict


class ToolEvent(TypedDict, total=False):
    tool: str
    action: str
    status: str
    recommended_next_step: str
    summary: str


class ExecutionState(TypedDict, total=False):
    latest_tool: str
    latest_action: str
    latest_status: str
    current_stage: str
    recommended_next_step: str
    active_collection: dict[str, Any]
    vision: dict[str, Any]
    style: dict[str, Any]
    trends: dict[str, Any]
    last_error: dict[str, Any]
    recent_events: list[ToolEvent]


def _parse_payload(content: object) -> dict[str, Any] | None:
    if not isinstance(content, str) or not content.strip():
        return None
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _append_recent_event(state: ExecutionState, event: ToolEvent) -> None:
    recent = [dict(item) for item in state.get("recent_events", []) if isinstance(item, dict)]
    recent.append(event)
    state["recent_events"] = recent[-6:]


def _top_trend_value(payload: dict[str, Any]) -> str:
    ranking = payload.get("ranking")
    if not isinstance(ranking, list) or not ranking:
        return ""
    first = ranking[0]
    if not isinstance(first, dict):
        return ""
    return str(first.get("name", "")).strip()


def reduce_tool_result_blocks(blocks: list[dict[str, Any]]) -> ExecutionState:
    tool_use_names: dict[str, str] = {}
    state: ExecutionState = {}

    for block in blocks:
        if not isinstance(block, dict):
            continue

        block_type = str(block.get("type", "")).strip()
        if block_type == "tool_use":
            tool_use_id = str(block.get("id", "")).strip()
            tool_name = str(block.get("name", "")).strip()
            if tool_use_id and tool_name:
                tool_use_names[tool_use_id] = tool_name
            continue

        if block_type != "tool_result":
            continue

        payload = _parse_payload(block.get("content"))
        if not payload:
            continue

        tool_use_id = str(block.get("tool_use_id", "")).strip()
        tool_name = tool_use_names.get(tool_use_id, "")
        latest_action = str(payload.get("action") or payload.get("status") or payload.get("error_type") or "").strip()
        latest_status = (
            "error"
            if payload.get("error") or payload.get("error_type")
            else str(payload.get("status", "")).strip() or "ok"
        )
        recommended_next_step = str(payload.get("recommended_next_step", "")).strip()

        if tool_name:
            state["latest_tool"] = tool_name
        if latest_action:
            state["latest_action"] = latest_action
        if latest_status:
            state["latest_status"] = latest_status
        if recommended_next_step:
            state["recommended_next_step"] = recommended_next_step

        if tool_name == "fashion_vision" and payload.get("ok") is True:
            vision = {
                "retrieval_query": str(((payload.get("analysis") or {}) if isinstance(payload.get("analysis"), dict) else {}).get("retrieval_query_en", "")).strip(),
                "primary_category": str(payload.get("vision_primary_category", "")).strip().lower(),
                "summary_zh": str(((payload.get("analysis") or {}) if isinstance(payload.get("analysis"), dict) else {}).get("summary_zh", "")).strip(),
            }
            state["vision"] = vision
            state["current_stage"] = "ready_to_start_collection"
            _append_recent_event(state, {
                "tool": tool_name,
                "action": "vision_grounded",
                "status": "ok",
                "recommended_next_step": recommended_next_step or "start_collection",
                "summary": vision.get("summary_zh", "") or vision.get("retrieval_query", ""),
            })
            continue

        if tool_name == "search_style" and str(payload.get("status", "")).strip() == "ok":
            retrieval_plan = payload.get("retrieval_plan", {}) if isinstance(payload.get("retrieval_plan"), dict) else {}
            primary_style = payload.get("primary_style", {}) if isinstance(payload.get("primary_style"), dict) else {}
            style = {
                "style_name": str(primary_style.get("style_name", "")).strip(),
                "retrieval_query": str(retrieval_plan.get("retrieval_query_en", "")).strip(),
                "status": "ok",
            }
            state["style"] = style
            state["current_stage"] = "ready_to_start_collection"
            _append_recent_event(state, {
                "tool": tool_name,
                "action": "style_grounded",
                "status": "ok",
                "recommended_next_step": str((retrieval_plan.get("agent_guidance", {}) if isinstance(retrieval_plan.get("agent_guidance"), dict) else {}).get("recommended_next_step", "")).strip() or "start_collection",
                "summary": style.get("style_name", "") or style.get("retrieval_query", ""),
            })
            continue

        if str(payload.get("status", "")).strip() == "collection_started":
            state["active_collection"] = {
                "query": str(payload.get("query", "")).strip(),
                "total": int(payload.get("total", 0) or 0),
                "filters_applied": [str(item).strip() for item in payload.get("seeded_filters", []) if str(item).strip()],
            }
            state["current_stage"] = "collection_active"
            _append_recent_event(state, {
                "tool": tool_name or "start_collection",
                "action": "collection_started",
                "status": "ok",
                "recommended_next_step": recommended_next_step or "add_filter",
                "summary": str(payload.get("message", "")).strip(),
            })
            continue

        if str(payload.get("action", "")).strip() in {"filter_added", "filter_already_active", "filter_rejected"}:
            active_collection = dict(state.get("active_collection", {}))
            active_collection["filters_applied"] = [
                str(item).strip()
                for item in payload.get("active_filters", active_collection.get("filters_applied", []))
                if str(item).strip()
            ]
            if payload.get("remaining") not in (None, ""):
                active_collection["total"] = int(payload.get("remaining", 0) or 0)
            state["active_collection"] = active_collection
            state["current_stage"] = "collection_active"
            _append_recent_event(state, {
                "tool": tool_name or "add_filter",
                "action": str(payload.get("action", "")).strip(),
                "status": "ok",
                "recommended_next_step": "show_collection" if int(payload.get("remaining", 0) or 0) > 0 else "",
                "summary": str(payload.get("message", "")).strip(),
            })
            continue

        if str(payload.get("action", "")).strip() == "show_collection":
            state["active_collection"] = {
                "query": str(payload.get("query", "")).strip(),
                "total": int(payload.get("total", 0) or 0),
                "filters_applied": [str(item).strip() for item in payload.get("filters_applied", []) if str(item).strip()],
                "search_request_id": str(payload.get("search_request_id", "")).strip(),
            }
            state["current_stage"] = "ready_to_present"
            _append_recent_event(state, {
                "tool": tool_name or "show_collection",
                "action": "show_collection",
                "status": "ok",
                "recommended_next_step": recommended_next_step or "done",
                "summary": str(payload.get("message", "")).strip(),
            })
            continue

        if tool_name == "analyze_trends" and not payload.get("error"):
            trends = {
                "dimension": str(payload.get("dimension", "")).strip(),
                "total_items_analyzed": int(payload.get("total_items_analyzed", 0) or 0),
                "top_value": _top_trend_value(payload),
            }
            state["trends"] = trends
            state["current_stage"] = state.get("current_stage", "discovery")
            _append_recent_event(state, {
                "tool": tool_name,
                "action": "trend_analysis",
                "status": "ok",
                "recommended_next_step": recommended_next_step,
                "summary": trends.get("dimension", ""),
            })
            continue

        if payload.get("error") or payload.get("error_type"):
            state["last_error"] = {
                "tool": tool_name,
                "error_type": str(payload.get("error_type", "")).strip() or "error",
                "message": str(payload.get("message") or payload.get("error") or "").strip(),
                "suggested_strategy": str(payload.get("suggested_strategy", "")).strip(),
            }
            state["current_stage"] = "recovery_needed"
            _append_recent_event(state, {
                "tool": tool_name,
                "action": str(payload.get("error_type", "")).strip() or "error",
                "status": "error",
                "recommended_next_step": recommended_next_step,
                "summary": str(payload.get("message") or payload.get("error") or "").strip(),
            })

    return state


def merge_execution_state(
    current: dict[str, Any] | None,
    patch: dict[str, Any] | None,
) -> ExecutionState:
    merged: ExecutionState = dict(current or {})
    if not patch:
        return merged

    for key, value in patch.items():
        if key == "recent_events" and isinstance(value, list):
            existing = [dict(item) for item in merged.get("recent_events", []) if isinstance(item, dict)]
            appended = existing + [dict(item) for item in value if isinstance(item, dict)]
            merged["recent_events"] = appended[-6:]
            continue
        if isinstance(value, dict):
            next_value = dict(merged.get(key, {}) if isinstance(merged.get(key), dict) else {})
            next_value.update(value)
            merged[key] = next_value
            continue
        merged[key] = value

    return merged


def format_execution_state(state: dict[str, Any] | None) -> str:
    payload = dict(state or {})
    if not payload:
        return ""

    lines = ["[EXECUTION_STATE]"]
    for key in ("current_stage", "latest_tool", "latest_action", "latest_status", "recommended_next_step"):
        value = str(payload.get(key, "")).strip()
        if value:
            lines.append(f"{key}={value}")

    active_collection = payload.get("active_collection", {})
    if isinstance(active_collection, dict) and active_collection:
        query = str(active_collection.get("query", "")).strip()
        total = active_collection.get("total")
        filters_applied = [str(item).strip() for item in active_collection.get("filters_applied", []) if str(item).strip()]
        if query:
            lines.append(f"active_collection.query={query}")
        if total not in (None, ""):
            lines.append(f"active_collection.total={int(total)}")
        if filters_applied:
            lines.append("active_collection.filters=" + ", ".join(filters_applied))

    for section in ("vision", "style", "trends", "last_error"):
        section_payload = payload.get(section, {})
        if not isinstance(section_payload, dict) or not section_payload:
            continue
        compact_parts = [
            f"{subkey}:{str(subvalue).strip()}"
            for subkey, subvalue in section_payload.items()
            if str(subvalue).strip()
        ]
        if compact_parts:
            lines.append(f"{section}=" + " | ".join(compact_parts))

    recent_events = payload.get("recent_events", [])
    if isinstance(recent_events, list) and recent_events:
        compact = []
        for item in recent_events[-4:]:
            if not isinstance(item, dict):
                continue
            tool = str(item.get("tool", "")).strip()
            action = str(item.get("action", "")).strip()
            if tool or action:
                compact.append(f"{tool}:{action}")
        if compact:
            lines.append("recent_events=" + " -> ".join(compact))

    return "\n".join(lines)
