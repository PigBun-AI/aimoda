from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from ..services.retrieval_session_engine import RetrievalSessionEngine, ToolExecutionResult


ToolVisibility = Literal["internal", "mcp", "both"]


@dataclass(slots=True)
class ToolActor:
    user_id: int | None = None
    agent_id: str | None = None
    agent_name: str | None = None
    permissions: list[str] = field(default_factory=list)
    role: str | None = None
    auth_token: str | None = None


@dataclass(slots=True)
class ToolExecutionContext:
    actor: ToolActor = field(default_factory=ToolActor)
    source: Literal["langgraph", "mcp"] = "langgraph"
    thread_id: str | None = None
    chat_session_id: str | None = None
    run_id: str | None = None
    cancel_check: Callable[[], None] | None = None
    current_search_session: dict[str, Any] | None = None
    query_context: dict[str, Any] | None = None
    runtime_plan: dict[str, Any] | None = None


ToolExecutor = Callable[[ToolExecutionContext, dict[str, Any]], ToolExecutionResult]


@dataclass(slots=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    visibility: ToolVisibility
    auth_scope: str
    mutates: bool
    executor: ToolExecutor


_ENGINE = RetrievalSessionEngine()

TOOL_ORDER: tuple[str, ...] = (
    "search_style",
    "fashion_vision",
    "start_collection",
    "add_filter",
    "remove_filter",
    "peek_collection",
    "show_collection",
    "explore_colors",
    "analyze_trends",
    "get_image_details",
)


_START_COLLECTION_OUTPUT = {
    "type": "object",
    "properties": {
        "status": {"type": "string"},
        "retrieval_session_id": {"type": "string"},
        "total": {"type": "integer"},
        "query": {"type": "string"},
        "filters_applied": {"type": "array", "items": {"type": "string"}},
        "recommended_next_step": {"type": "string"},
        "message": {"type": "string"},
    },
    "required": ["status", "retrieval_session_id", "total", "query", "filters_applied", "recommended_next_step", "message"],
}

_FILTER_OUTPUT = {
    "type": "object",
    "properties": {
        "retrieval_session_id": {"type": "string"},
        "action": {"type": "string"},
        "remaining": {"type": "integer"},
        "active_filters": {"type": "array", "items": {"type": "string"}},
        "removed": {"type": "array", "items": {"type": "string"}},
        "message": {"type": "string"},
    },
    "required": ["retrieval_session_id", "action", "message"],
}

_SHOW_COLLECTION_OUTPUT = {
    "type": "object",
    "properties": {
        "action": {"type": "string"},
        "retrieval_session_id": {"type": "string"},
        "search_request_id": {"type": ["string", "null"]},
        "total": {"type": "integer"},
        "query": {"type": "string"},
        "filters_applied": {"type": "array", "items": {"type": "string"}},
        "recommended_next_step": {"type": "string"},
        "message": {"type": "string"},
    },
    "required": ["action", "retrieval_session_id", "total", "query", "filters_applied", "recommended_next_step", "message"],
}

_GENERIC_JSON_OUTPUT = {
    "type": "object",
}


def _ctx_to_tool_config(ctx: ToolExecutionContext) -> dict[str, Any] | None:
    configurable: dict[str, Any] = {}
    if ctx.thread_id:
        configurable["thread_id"] = ctx.thread_id
    if ctx.run_id:
        configurable["run_id"] = ctx.run_id
    if not configurable:
        return None
    return {"configurable": configurable}


def _invoke_tool_json(tool_name: str, ctx: ToolExecutionContext, *args: Any, **kwargs: Any) -> ToolExecutionResult:
    from . import tools as agent_tools

    tool_obj = getattr(agent_tools, tool_name)
    config = _ctx_to_tool_config(ctx)
    if config is not None:
        kwargs["config"] = config

    raw = tool_obj.func(*args, **kwargs)
    payload = json.loads(raw) if isinstance(raw, str) else raw
    return ToolExecutionResult(payload=payload if isinstance(payload, dict) else {"result": payload})


TOOL_REGISTRY: dict[str, ToolSpec] = {
    "search_style": ToolSpec(
        name="search_style",
        description="Search the abstract fashion style library and return retrieval-ready semantic cues.",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 3},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        output_schema=_GENERIC_JSON_OUTPUT,
        visibility="both",
        auth_scope="user",
        mutates=False,
        executor=lambda ctx, payload: _invoke_tool_json(
            "search_style",
            ctx,
            str(payload.get("query", "") or ""),
            limit=int(payload.get("limit", 3) or 3),
        ),
    ),
    "fashion_vision": ToolSpec(
        name="fashion_vision",
        description="Analyze current session images with the fashion VLM and return retrieval-ready cues.",
        input_schema={
            "type": "object",
            "properties": {
                "user_request": {"type": "string", "default": ""},
            },
            "additionalProperties": False,
        },
        output_schema=_GENERIC_JSON_OUTPUT,
        visibility="internal",
        auth_scope="user",
        mutates=False,
        executor=lambda ctx, payload: _invoke_tool_json(
            "fashion_vision",
            ctx,
            str(payload.get("user_request", "") or ""),
        ),
    ),
    "start_collection": ToolSpec(
        name="start_collection",
        description="Start or reset a retrieval collection and return a stable retrieval_session_id.",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "default": ""},
                "retrieval_session_id": {"type": "string"},
            },
            "additionalProperties": False,
        },
        output_schema=_START_COLLECTION_OUTPUT,
        visibility="both",
        auth_scope="user",
        mutates=True,
        executor=lambda ctx, payload: _ENGINE.start_collection(ctx, payload),
    ),
    "add_filter": ToolSpec(
        name="add_filter",
        description="Add one concrete filter onto an existing retrieval_session_id.",
        input_schema={
            "type": "object",
            "properties": {
                "retrieval_session_id": {"type": "string"},
                "dimension": {"type": "string"},
                "value": {"type": "string"},
                "category": {"type": "string"},
            },
            "required": ["retrieval_session_id", "dimension", "value"],
            "additionalProperties": False,
        },
        output_schema=_FILTER_OUTPUT,
        visibility="both",
        auth_scope="user",
        mutates=True,
        executor=lambda ctx, payload: _ENGINE.add_filter(ctx, payload),
    ),
    "remove_filter": ToolSpec(
        name="remove_filter",
        description="Remove one active filter from an existing retrieval_session_id.",
        input_schema={
            "type": "object",
            "properties": {
                "retrieval_session_id": {"type": "string"},
                "dimension": {"type": "string"},
                "category": {"type": "string"},
            },
            "required": ["retrieval_session_id", "dimension"],
            "additionalProperties": False,
        },
        output_schema=_FILTER_OUTPUT,
        visibility="both",
        auth_scope="user",
        mutates=True,
        executor=lambda ctx, payload: _ENGINE.remove_filter(ctx, payload),
    ),
    "peek_collection": ToolSpec(
        name="peek_collection",
        description="Preview the current collection metadata without displaying results to the user.",
        input_schema={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 15},
            },
            "additionalProperties": False,
        },
        output_schema=_GENERIC_JSON_OUTPUT,
        visibility="internal",
        auth_scope="user",
        mutates=False,
        executor=lambda ctx, payload: _invoke_tool_json(
            "peek_collection",
            ctx,
            limit=int(payload.get("limit", 15) or 15),
        ),
    ),
    "show_collection": ToolSpec(
        name="show_collection",
        description="Summarize the current retrieval collection and optionally materialize an artifact ref.",
        input_schema={
            "type": "object",
            "properties": {
                "retrieval_session_id": {"type": "string"},
            },
            "required": ["retrieval_session_id"],
            "additionalProperties": False,
        },
        output_schema=_SHOW_COLLECTION_OUTPUT,
        visibility="both",
        auth_scope="user",
        mutates=False,
        executor=lambda ctx, payload: _ENGINE.show_collection(ctx, payload),
    ),
    "explore_colors": ToolSpec(
        name="explore_colors",
        description="Explore images by color family and summarize shade / companion-color distribution.",
        input_schema={
            "type": "object",
            "properties": {
                "color": {"type": "string"},
                "categories": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "brand": {"type": "string"},
            },
            "required": ["color"],
            "additionalProperties": False,
        },
        output_schema=_GENERIC_JSON_OUTPUT,
        visibility="both",
        auth_scope="user",
        mutates=False,
        executor=lambda ctx, payload: _invoke_tool_json(
            "explore_colors",
            ctx,
            str(payload.get("color", "") or ""),
            categories=payload.get("categories"),
            brand=payload.get("brand"),
        ),
    ),
    "analyze_trends": ToolSpec(
        name="analyze_trends",
        description="Analyze aggregate trend counts for a chosen dimension with optional filters.",
        input_schema={
            "type": "object",
            "properties": {
                "dimension": {"type": "string"},
                "categories": {"type": "array", "items": {"type": "string"}},
                "fabric": {"type": "string"},
                "color": {"type": "string"},
                "pattern": {"type": "string"},
                "silhouette": {"type": "string"},
                "brand": {"type": "string"},
                "quarter": {"type": "array", "items": {"type": "string"}},
                "year_min": {"type": "integer"},
                "top_n": {"type": "integer", "default": 30},
                "search": {"type": "string"},
            },
            "required": ["dimension"],
            "additionalProperties": False,
        },
        output_schema=_GENERIC_JSON_OUTPUT,
        visibility="both",
        auth_scope="user",
        mutates=False,
        executor=lambda ctx, payload: _invoke_tool_json(
            "analyze_trends",
            ctx,
            payload.get("dimension"),
            categories=payload.get("categories"),
            fabric=payload.get("fabric"),
            color=payload.get("color"),
            pattern=payload.get("pattern"),
            silhouette=payload.get("silhouette"),
            brand=payload.get("brand"),
            quarter=payload.get("quarter"),
            year_min=payload.get("year_min"),
            top_n=int(payload.get("top_n", 30) or 30),
            search=payload.get("search"),
        ),
    ),
    "get_image_details": ToolSpec(
        name="get_image_details",
        description="Fetch the full payload details of a specific image by image_id.",
        input_schema={
            "type": "object",
            "properties": {
                "image_id": {"type": "string"},
            },
            "required": ["image_id"],
            "additionalProperties": False,
        },
        output_schema=_GENERIC_JSON_OUTPUT,
        visibility="both",
        auth_scope="user",
        mutates=False,
        executor=lambda ctx, payload: _invoke_tool_json(
            "get_image_details",
            ctx,
            str(payload.get("image_id", "") or ""),
        ),
    ),
}


def get_tool_spec(name: str) -> ToolSpec:
    try:
        return TOOL_REGISTRY[name]
    except KeyError as exc:
        raise KeyError(f"Unknown tool: {name}") from exc



def execute_registered_tool(name: str, ctx: ToolExecutionContext, payload: dict[str, Any]) -> ToolExecutionResult:
    return get_tool_spec(name).executor(ctx, payload)



def list_tool_specs(*, visibility: ToolVisibility | None = None) -> list[ToolSpec]:
    specs = [TOOL_REGISTRY[name] for name in TOOL_ORDER if name in TOOL_REGISTRY]
    if visibility is None:
        return specs
    return [spec for spec in specs if spec.visibility == visibility or spec.visibility == "both"]
