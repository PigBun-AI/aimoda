"""
Fashion Search Agent Tools — LangGraph tool definitions.

Tool functions for the AI agent. Infrastructure and session
management are imported from:
  - qdrant_utils: Qdrant client, filters, formatting, vector search
  - session_state: Thread-based session management
  - color_utils: Color keyword matching and Delta-E calculations
"""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional
from langchain_core.tools import tool, InjectedToolArg
from langchain_core.runnables import RunnableConfig
from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny

from .qdrant_utils import (
    get_qdrant,
    get_collection,
    encode_text,
    encode_image,
    apply_aesthetic_boost,
    build_qdrant_filter,
    format_result,
    build_guidance,
    scroll_all,
)
from .session_state import (
    get_session,
    set_session,
    get_thread_id,
    build_session_filter,
    count_session,
    apply_session_filters,
    get_session_page,
    available_values,
)
from .harness import (
    infer_active_category,
    get_turn_context,
    note_invalid_filter_attempt,
    clear_invalid_filter_attempt,
    update_session_semantics,
)
from .color_utils import COLOR_KEYWORDS, color_matches
from ..services.chat_service import create_artifact, set_session_agent_runtime
from ..services.fashion_vision_service import analyze_fashion_images, FashionVisionError
from ..services.style_knowledge_service import search_style_knowledge
from ..services.style_feedback_service import record_style_gap_feedback
from .query_context import get_query_context, average_embeddings, get_session_image_blocks
from .query_context import remember_session_style, set_query_context, merge_query_contexts
from ..config import settings

# ── Backward-compatible aliases used by routers and other modules ──
_format_result = format_result
_get_collection = get_collection
_encode_text = encode_text
_encode_image = encode_image
_apply_aesthetic_boost = apply_aesthetic_boost
_build_qdrant_filter = build_qdrant_filter
_build_guidance = build_guidance
_scroll_all = scroll_all
_get_session = get_session
_set_session = set_session
_build_session_filter = build_session_filter
_count_session = count_session
_apply_session_filters = apply_session_filters
_available_values = available_values


def _structured_filter_error(
    *,
    dimension: str,
    value: str,
    reason: str,
    inferred_category: str | None = None,
    error_type: str = "invalid_filter_request",
    blocked_by_harness: bool = False,
    suggested_strategy: str | None = None,
    suggested_next_actions: list[str] | None = None,
) -> str:
    payload = {
        "error": reason,
        "message": reason,
        "error_type": error_type,
        "dimension": dimension,
        "value": value,
        "retry_same_call": False,
    }
    if blocked_by_harness:
        payload["blocked_by_harness"] = True
    if suggested_strategy:
        payload["suggested_strategy"] = suggested_strategy
    if suggested_next_actions:
        payload["suggested_next_actions"] = suggested_next_actions
    if inferred_category:
        payload["resolved_category_hint"] = inferred_category
        payload["suggested_next_call"] = (
            f'add_filter("{dimension}", "{value}", category="{inferred_category}")'
        )
    return json.dumps(payload, ensure_ascii=False)


def _build_recovery_actions(
    *,
    dimension: str,
    value: str,
    category: str | None,
) -> list[str]:
    if category:
        return [
            f'add_filter("{dimension}", "{value}", category="{category}")',
            "show_collection()",
        ]

    return [
        'add_filter("category", "<garment-category>")',
        'start_collection("<style-or-category enriched query>")',
    ]


def _structured_argument_error(
    *,
    dimension: str,
    value: str | None,
    reason: str,
) -> str:
    return json.dumps({
        "error": reason,
        "message": reason,
        "error_type": "invalid_arguments",
        "dimension": dimension,
        "value": value,
        "retry_same_call": False,
        "suggested_strategy": "Provide a concrete non-empty filter value before retrying.",
    }, ensure_ascii=False)


def _normalize_optional_tool_string(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    if isinstance(value, (int, float, bool)):
        normalized = str(value).strip()
        return normalized or None
    return None


def _should_autobind_brand_dimension(thread_id: str, *, value: str | None = None, brand: str | None = None) -> bool:
    context = get_turn_context(thread_id) or {}
    if not context.get("brand_only_request"):
        return False
    return bool((value and value.strip()) or (brand and brand.strip()))


def _session_id_from_config(config: RunnableConfig | None) -> str | None:
    if not config:
        return None
    thread_id = get_thread_id(config)
    parts = thread_id.split(":")
    if len(parts) < 2:
        return None
    return parts[1]


def _serialize_search_session(session: dict) -> dict:
    q_emb_raw = session.get("q_emb")
    q_emb_list = (
        q_emb_raw.tolist() if hasattr(q_emb_raw, "tolist")
        else list(q_emb_raw) if q_emb_raw is not None
        else None
    )
    return {
        "query": session.get("query", ""),
        "vector_type": session.get("vector_type", "tag"),
        "q_emb": q_emb_list,
        "filters": session.get("filters", []),
        "active": session.get("active", False),
    }


def _persist_agent_runtime_state(
    *,
    config: RunnableConfig | None,
    thread_id: str,
    session: dict,
) -> None:
    session_id = _session_id_from_config(config)
    if not session_id:
        return

    try:
        set_session_agent_runtime(
            session_id,
            {
                "search_session": _serialize_search_session(session),
                "semantics": update_session_semantics(
                    thread_id=thread_id,
                    query_text=str(session.get("query", "")),
                    session_filters=session.get("filters", []),
                ),
            },
        )
    except Exception:
        # Runtime persistence is a resilience layer and must not break retrieval.
        return


def _persist_runtime_semantics(
    *,
    config: RunnableConfig | None,
    thread_id: str,
) -> None:
    session_id = _session_id_from_config(config)
    if not session_id:
        return

    session = get_session(config or {"configurable": {"thread_id": thread_id}})
    try:
        set_session_agent_runtime(
            session_id,
            {
                "search_session": _serialize_search_session(session),
                "semantics": update_session_semantics(
                    thread_id=thread_id,
                    query_text=str(session.get("query", "")),
                    session_filters=session.get("filters", []),
                ),
            },
        )
    except Exception:
        return


def _normalize_vector(vector: list[float]) -> list[float]:
    norm = sum(value * value for value in vector) ** 0.5
    if norm < 1e-9:
        return vector
    return [value / norm for value in vector]


def _fuse_query_vectors(
    *,
    text_vector: list[float] | None,
    style_vector: list[float] | None = None,
    image_vector: list[float] | None,
) -> list[float] | None:
    vectors = {
        "text": text_vector,
        "style": style_vector,
        "image": image_vector,
    }
    available = {name: vector for name, vector in vectors.items() if vector is not None}
    if not available:
        return None
    if len(available) == 1:
        return _normalize_vector(next(iter(available.values())) or [])

    if image_vector is not None and style_vector is not None and text_vector is not None:
        weights = {"image": 0.5, "style": 0.3, "text": 0.2}
    elif style_vector is not None and text_vector is not None:
        weights = {"style": 0.65, "text": 0.35}
    elif image_vector is not None and style_vector is not None:
        weights = {"image": 0.65, "style": 0.35}
    elif image_vector is not None and text_vector is not None:
        weights = {"image": 0.7, "text": 0.3}
    else:
        weights = {name: 1.0 / len(available) for name in available}

    reference = next(iter(available.values()))
    fused = [0.0] * len(reference)
    for name, vector in available.items():
        assert vector is not None
        weight = weights.get(name, 0.0)
        for index, value in enumerate(vector):
            fused[index] += weight * value
    return _normalize_vector(fused)


def _compact_fashion_vision_result(analysis: dict) -> dict:
    merged = analysis.get("merged_understanding", {}) if isinstance(analysis, dict) else {}
    hard_filters = merged.get("hard_filters", {}) if isinstance(merged, dict) else {}
    return {
        "summary_zh": merged.get("summary_zh", ""),
        "retrieval_query_en": merged.get("retrieval_query_en", ""),
        "style_keywords": merged.get("style_keywords", []),
        "hard_filters": {
            "category": hard_filters.get("category", []),
            "color": hard_filters.get("color", []),
            "fabric": hard_filters.get("fabric", []),
            "gender": hard_filters.get("gender", ""),
            "season": hard_filters.get("season", []),
        },
        "follow_up_questions_zh": merged.get("follow_up_questions_zh", []),
    }


def _run_coro_sync(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(asyncio.run, coro)
        return future.result()


@tool
def fashion_vision(
    user_request: str = "",
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Analyze the session's latest uploaded image(s) with a fashion-focused VLM.

    Use this whenever the user's request depends on understanding uploaded images.
    The tool returns compact structured JSON optimized for retrieval planning.
    """
    thread_id = get_thread_id(config)
    image_blocks = get_session_image_blocks(thread_id)
    if not image_blocks:
        return json.dumps({
            "ok": False,
            "error": "No uploaded images found in the current session.",
        }, ensure_ascii=False)

    try:
        analysis = _run_coro_sync(analyze_fashion_images(image_blocks, user_request=user_request))
    except FashionVisionError as exc:
        return json.dumps({
            "ok": False,
            "error": str(exc),
        }, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({
            "ok": False,
            "error": f"fashion_vision failed: {exc}",
        }, ensure_ascii=False)

    session_id = _session_id_from_config(config)
    artifact_id = None
    if session_id:
        artifact = create_artifact(
            session_id=session_id,
            artifact_type="vision_analysis",
            storage_type="database",
            content=json.dumps(analysis, ensure_ascii=False),
            metadata={
                "kind": "vision_analysis",
                "tool": "fashion_vision",
                "source_image_count": len(image_blocks),
                "model": analysis.get("model", ""),
            },
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
        artifact_id = artifact["id"]

    return json.dumps({
        "ok": True,
        "artifact_id": artifact_id,
        "image_count": len(image_blocks),
        "model": analysis.get("model", ""),
        "analysis": _compact_fashion_vision_result(analysis),
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: search_style
# ═══════════════════════════════════════════════════════════════

@tool
def search_style(
    query: str,
    limit: int = 3,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Search the abstract fashion style library and return retrieval-ready cues.

    Use this when the user asks for an abstract style such as 老钱风、法式、极简、
    通勤、Y2K、静奢、甜酷、知识分子等. The tool returns:
    - canonical style match
    - compact style features
    - retrieval_query_en for semantic search
    - suggested concrete filters with lower failure risk

    Typical next step:
    1. call search_style(query)
    2. use retrieval_plan.retrieval_query_en to call start_collection(...)
    3. only then add high-confidence concrete filters if needed
    """
    try:
        payload = search_style_knowledge(query, limit=max(1, min(limit, 5)))
    except Exception as exc:
        return json.dumps({
            "status": "error",
            "query": query,
            "error": f"search_style failed: {exc}",
            "retry_same_call": False,
            "suggested_strategy": (
                "Translate the style goal into a visual English retrieval query manually, "
                "then call start_collection(query=...)."
            ),
        }, ensure_ascii=False)

    if payload.get("status") == "ok" and config:
        thread_id = get_thread_id(config)
        primary_style = payload.get("primary_style", {}) if isinstance(payload.get("primary_style"), dict) else {}
        retrieval_plan = payload.get("retrieval_plan", {}) if isinstance(payload.get("retrieval_plan"), dict) else {}
        style_retrieval_query = str(retrieval_plan.get("retrieval_query_en", "")).strip()
        style_rich_text = str(payload.get("rich_text", "")).strip() or str(retrieval_plan.get("style_rich_text", "")).strip()
        style_name = str(primary_style.get("style_name", "")).strip()

        if style_retrieval_query or style_rich_text:
            remember_session_style(
                thread_id,
                style_retrieval_query=style_retrieval_query,
                style_rich_text=style_rich_text,
                style_name=style_name,
            )
            set_query_context(
                thread_id,
                merge_query_contexts(
                    get_query_context(thread_id),
                    {
                        "style_retrieval_query": style_retrieval_query,
                        "style_rich_text": style_rich_text,
                        "style_name": style_name,
                    },
                ),
            )

        update_session_semantics(
            thread_id=thread_id,
            explicit_style_name=style_name or None,
            style_retrieval_query=style_retrieval_query or None,
            style_rich_text=style_rich_text or None,
        )
        _persist_runtime_semantics(config=config, thread_id=thread_id)
    elif payload.get("status") == "not_found":
        try:
            thread_id = get_thread_id(config) if config else None
            feedback = record_style_gap_feedback(
                query=str(payload.get("query", query) or query),
                session_id=_session_id_from_config(config),
                thread_id=thread_id,
                trigger_tool="search_style",
                search_stage=str(payload.get("search_stage", "not_found") or "not_found"),
                fallback_suggestion=str(payload.get("fallback_suggestion", "") or ""),
                extra_context={
                    "message": str(payload.get("message", "") or ""),
                },
            )
            if feedback:
                payload["feedback_logged"] = True
                payload["feedback_id"] = feedback.get("signal_id")
                payload["feedback_total_hits"] = feedback.get("total_hits", 0)
                payload["feedback_unique_sessions"] = feedback.get("unique_sessions", 0)
        except Exception:
            payload["feedback_logged"] = False

    return json.dumps(payload, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: start_collection
# ═══════════════════════════════════════════════════════════════

@tool
def start_collection(
    query: str = "",
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Start a new image collection session. Call this FIRST before adding filters.

    Args:
        query: Optional English description for semantic ranking.
            If empty, starts from the full database.
            If provided, uses vector similarity to rank results.

    Returns: Total number of images in the initial collection.
    """
    client = get_qdrant()

    thread_id = get_thread_id(config)
    query_context = get_query_context(thread_id) or {}
    image_vectors = query_context.get("image_embeddings", [])
    image_vector = average_embeddings(image_vectors) if image_vectors else None
    style_retrieval_query = str(query_context.get("style_retrieval_query", "")).strip()
    style_rich_text = str(query_context.get("style_rich_text", "")).strip()

    text_vector = encode_text(query) if query else None
    style_semantic_text = style_rich_text or style_retrieval_query
    style_vector = encode_text(style_semantic_text) if style_semantic_text else None
    fused_vector = _fuse_query_vectors(
        text_vector=text_vector,
        style_vector=style_vector,
        image_vector=image_vector,
    )
    if fused_vector is not None:
        fused_vector = apply_aesthetic_boost(fused_vector)

    effective_query = query or style_retrieval_query

    session = {
        "query": effective_query,
        "vector_type": "fashion_clip",
        "q_emb": fused_vector,
        "filters": [],
        "active": True,
    }

    set_session(config, session)
    _persist_agent_runtime_state(config=config, thread_id=thread_id, session=session)
    count = count_session(client, session)
    return json.dumps({
        "status": "collection_started",
        "total": count,
        "query": effective_query or "(all images)",
        "style_retrieval_query": style_retrieval_query or None,
        "style_rich_text_used": bool(style_semantic_text),
        "message": (
            f"Collection started with {count} images. Use add_filter to narrow down."
            if not image_vectors and not style_retrieval_query
            else (
                f"Collection started with {count} images using {len(image_vectors)} uploaded image(s). Use add_filter to narrow down."
                if image_vectors and not style_retrieval_query
                else (
                    f"Collection started with {count} images using style knowledge grounding. Use add_filter to narrow down."
                    if style_retrieval_query and not image_vectors
                    else (
                        f"Collection started with {count} images using {len(image_vectors)} uploaded image(s) and style knowledge grounding. "
                        "Use add_filter to narrow down."
                    )
                )
            )
        ),
    })


# ═══════════════════════════════════════════════════════════════
#  Tool: add_filter
# ═══════════════════════════════════════════════════════════════

@tool
def add_filter(
    dimension: Optional[str],
    value: Optional[str],
    category: Optional[str] = None,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Add ONE filter to narrow the current collection. Call start_collection first.

    CRITICAL RULE FOR CATEGORY ARGUMENT:
    - If dimension="category", DO NOT pass the `category` argument.
    - If dimension is a garment attribute (color, fabric, pattern, silhouette, sleeve_length, garment_length, collar),
      you normally MUST pass the `category` argument.
    - Runtime harness exception: if the current turn or session already implies exactly one category,
      the system may auto-bind the garment attribute to that category.
    - If dimension is an image attribute (brand, gender, season, year_min, image_type), DO NOT pass `category`.

    Returns: remaining count. If 0, suggests available values — DO NOT add this filter.
    """
    session = get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()
    thread_id = get_thread_id(config)

    dimension = (_normalize_optional_tool_string(dimension) or "").lower()
    value = _normalize_optional_tool_string(value)
    if not dimension and _should_autobind_brand_dimension(thread_id, value=value):
        dimension = "brand"
    if not dimension:
        return _structured_argument_error(
            dimension="",
            value=value,
            reason="Filter dimension must be a non-empty string.",
        )
    if value is None:
        return _structured_argument_error(
            dimension=dimension,
            value=value,
            reason=f'Filter "{dimension}" requires a concrete non-empty value.',
        )
    if category:
        category = (_normalize_optional_tool_string(category) or "").lower() or None

    GARMENT_TAG_DIMS = {"color", "fabric", "pattern", "silhouette"}
    GARMENT_NESTED_DIMS = {"sleeve_length", "sleeve", "garment_length", "length", "collar"}
    meta_dims = {"brand", "gender", "season", "year_min", "image_type"}
    abstract_style_dims = {"style", "mood", "vibe"}

    DIM_TO_FIELD = {"sleeve_length": "sleeve", "sleeve": "sleeve",
                    "garment_length": "length", "length": "length",
                    "collar": "collar"}

    dim_normalized = dimension
    if dimension == "sleeve":
        dim_normalized = "sleeve_length"
    elif dimension == "length":
        dim_normalized = "garment_length"

    inferred_category = None
    if (
        settings.AGENT_RUNTIME_HARNESS_ENABLED
        and not category
        and dimension in (GARMENT_TAG_DIMS | GARMENT_NESTED_DIMS)
    ):
        inferred_category = infer_active_category(
            thread_id=thread_id,
            session_filters=session.get("filters", []),
        )
        if inferred_category:
            category = inferred_category

    if dimension in abstract_style_dims:
        return _structured_filter_error(
            dimension=dimension,
            value=value,
            reason=(
                f'"{dimension}" is not a supported filter dimension. '
                "Abstract style goals should be translated into a richer query or concrete filters first."
            ),
            error_type="unsupported_dimension",
            suggested_strategy=(
                "Call search_style first for abstract style goals, then use its retrieval_query_en to "
                "start a semantic collection before adding concrete garment filters."
            ),
            suggested_next_actions=[
                f'search_style("{value}")',
                'start_collection("<style-enriched semantic query>")',
            ],
        )

    if dimension == "category":
        entry = {"type": "category", "key": "category", "value": value}
    elif dimension in GARMENT_TAG_DIMS and category:
        tag_value = f"{category.lower()}:{value.lower()}"
        entry = {"type": "garment_tag", "key": f"{category}:{dimension}", "value": tag_value}
    elif dimension in GARMENT_NESTED_DIMS and category:
        field = DIM_TO_FIELD[dimension]
        entry = {"type": "garment_attr", "key": f"{category}:{dim_normalized}",
                 "field": field, "value": value}
    elif dimension in meta_dims:
        entry = {"type": "meta", "key": dimension, "value": value}
    else:
        if dimension in (GARMENT_TAG_DIMS | GARMENT_NESTED_DIMS):
            attempts = note_invalid_filter_attempt(
                thread_id=thread_id,
                dimension=dimension,
                value=value,
                category=category,
            )
            if (
                settings.AGENT_RUNTIME_HARNESS_ENABLED
                and attempts > settings.AGENT_RUNTIME_HARNESS_MAX_SAME_ERROR_RETRIES
            ):
                return _structured_filter_error(
                    dimension=dimension,
                    value=value,
                    reason=(
                        f"Repeated invalid '{dimension}' request blocked by runtime harness. "
                        "Resolve the garment category first, then continue filtering."
                    ),
                    inferred_category=inferred_category,
                    error_type="retry_blocked",
                    blocked_by_harness=True,
                    suggested_strategy=(
                        "Do not retry the same invalid call. Bind the garment attribute to a concrete category, "
                        "or repair the search query before continuing."
                    ),
                    suggested_next_actions=_build_recovery_actions(
                        dimension=dimension,
                        value=value,
                        category=inferred_category,
                    ),
                )
            return _structured_filter_error(
                dimension=dimension,
                value=value,
                reason=(
                    f"For '{dimension}' filter, specify which garment category. "
                    f'Example: add_filter("{dimension}", "{value}", category="dress")'
                ),
                inferred_category=inferred_category,
                suggested_strategy=(
                    "First resolve the garment category, then retry the attribute filter."
                ),
                suggested_next_actions=_build_recovery_actions(
                    dimension=dimension,
                    value=value,
                    category=inferred_category,
                ),
            )
        return _structured_filter_error(
            dimension=dimension,
            value=value,
            reason=f"Unknown dimension: {dimension}",
            error_type="unsupported_dimension",
            suggested_strategy=(
                "Only use supported retrieval dimensions. If the request is abstract, translate it into "
                "query text or concrete garment/image filters."
            ),
        )

    test_filters = session["filters"] + [entry]
    test_session = dict(session)
    test_session["filters"] = test_filters
    count = count_session(client, test_session)

    if count > 0:
        clear_invalid_filter_attempt(
            thread_id=thread_id,
            dimension=dimension,
            value=value,
            category=category,
        )
        session["filters"].append(entry)
        set_session(config, session)
        _persist_agent_runtime_state(config=config, thread_id=thread_id, session=session)
        filter_summary = []
        for f in session["filters"]:
            if f["type"] == "category":
                filter_summary.append(f"category={f['value']}")
            elif f["type"] == "garment_tag":
                filter_summary.append(f"{f['key']}={f['value'].split(':')[1]}")
            else:
                filter_summary.append(f"{f['key']}={f['value']}")

        return json.dumps({
            "action": "filter_added",
            "filter": f"{dimension}={value}" + (f" (on {category})" if category else ""),
            "remaining": count,
            "active_filters": filter_summary,
            "message": f"Added {dimension}={value}. {count} images remaining.",
            "resolved_category": inferred_category,
        })
    else:
        available = available_values(client, dimension, category, session["filters"])
        return json.dumps({
            "action": "filter_rejected",
            "filter": f"{dimension}={value}" + (f" (on {category})" if category else ""),
            "remaining": 0,
            "message": f"Adding {dimension}={value} would result in 0 images. Filter NOT added.",
            "available_values": available,
            "suggestion": "Try one of the available values instead, or skip this dimension.",
        })


# ═══════════════════════════════════════════════════════════════
#  Tool: remove_filter
# ═══════════════════════════════════════════════════════════════

@tool
def remove_filter(
    dimension: str,
    category: Optional[str] = None,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Remove a previously added filter. Undoes the narrowing for that dimension."""
    session = get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection."})

    client = get_qdrant()

    removed = []
    new_filters = []
    for f in session["filters"]:
        match = False
        if dimension == "category" and f["type"] == "category":
            match = True
        elif f["type"] in ("garment_tag", "garment_attr") and category:
            if f["key"].startswith(f"{category}:{dimension}"):
                match = True
        elif f["type"] == "meta" and f["key"] == dimension:
            match = True
        if match:
            removed.append(f)
        else:
            new_filters.append(f)

    session["filters"] = new_filters
    set_session(config, session)
    _persist_agent_runtime_state(config=config, thread_id=get_thread_id(config), session=session)
    count = count_session(client, session)

    return json.dumps({
        "action": "filter_removed",
        "removed": [f"{f.get('key', '')}={f.get('value', '')}" for f in removed],
        "remaining": count,
        "message": f"Removed {len(removed)} filter(s). {count} images remaining.",
    })


# ═══════════════════════════════════════════════════════════════
#  Tool: peek_collection
# ═══════════════════════════════════════════════════════════════

@tool
def peek_collection(
    limit: int = 15,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Secretly preview the current filtered collection to self-check.
    This does NOT display images to the user. Only returns text metadata for you to review.
    """
    session = get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()
    total = count_session(client, session)
    results = get_session_page(client, session, offset=0, limit=limit)

    peek_results = []
    for p in results:
        garment_details = []
        for g in p.payload.get("garments", []):
            detail = g.get("name", "")
            attrs = []
            for attr in ("fabric", "pattern", "silhouette", "sleeve",
                         "length", "collar"):
                v = g.get(attr, "")
                if v:
                    attrs.append(v)
            color_names = [c.get("name", "") for c in g.get("colors", []) if c.get("name")]
            if attrs or color_names:
                detail += f" ({', '.join(attrs + color_names)})"
            garment_details.append(detail)

        peek_results.append({
            "brand": p.payload.get("brand", "Unknown"),
            "style": p.payload.get("style", ""),
            "season": p.payload.get("season", ""),
            "year": p.payload.get("year", 0),
            "garments": ", ".join(garment_details),
        })

    return json.dumps({
        "total": total,
        "message": f"Peeked at top {len(peek_results)} images.",
        "peek_results": peek_results
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: show_collection
# ═══════════════════════════════════════════════════════════════

@tool
def show_collection(
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Get the final collection and send it to the frontend for display.
    Call this ONLY when you are completely finished filtering.
    """
    session = get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()
    count = count_session(client, session)

    filter_summary = []
    for f in session["filters"]:
        if f["type"] == "category":
            filter_summary.append(f"category={f['value']}")
        elif f["type"] == "garment_tag":
            filter_summary.append(f"{f['key']}={f['value'].split(':')[1]}")
        else:
            filter_summary.append(f"{f['key']}={f['value']}")

    serializable_session = _serialize_search_session(session)

    sample_images = []
    for point in get_session_page(client, session, offset=0, limit=8):
        item = format_result(point.payload, getattr(point, "score", 0))
        sample_images.append(item)

    search_request_id = None
    session_id = _session_id_from_config(config)
    if session_id:
        artifact = create_artifact(
            session_id=session_id,
            artifact_type="collection_result",
            storage_type="database",
            metadata={
                "search_session": serializable_session,
                "total": count,
                "filters_applied": filter_summary,
            },
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
        search_request_id = artifact["id"]

    return json.dumps({
        "action": "show_collection",
        "search_request_id": search_request_id,
        "total": count,
        "filters_applied": filter_summary,
        "message": f"Showing {count} matching images in paginated results. Filters applied: {len(filter_summary)}.",
        "sample_images": sample_images,
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: explore_colors
# ═══════════════════════════════════════════════════════════════

@tool
def explore_colors(
    color: str,
    categories: Optional[list[str]] = None,
    brand: Optional[str] = None,
) -> str:
    """Explore images by COLOR FAMILY. Reports companion colors and shade distribution.

    Args:
        color: Color keyword. "red", "green", "navy", "burgundy" etc.
        categories: Optional garment type filter
        brand: Optional brand filter
    """
    collection = get_collection()
    client = get_qdrant()
    qdrant_filter = build_qdrant_filter(categories=categories, brand=brand)
    pts = scroll_all(client, collection, scroll_filter=qdrant_filter)

    refs = COLOR_KEYWORDS.get(color.lower())
    if not refs:
        return json.dumps({"error": f"Unknown color: {color}. Supported: {list(COLOR_KEYWORDS.keys())}"})

    matching = []
    shades: dict[str, int] = {}
    companions: dict[str, int] = {}

    for p in pts:
        found = False
        item_companions = []
        for g in p.payload.get("garments", []):
            g_hexes = [c.get("hex") for c in g.get("colors", []) if c.get("hex")]
            g_names = [c.get("name", "") for c in g.get("colors", [])]
            for i, gh in enumerate(g_hexes):
                if color_matches([gh], color):
                    found = True
                    shade = g_names[i] if i < len(g_names) else "unknown"
                    shades[shade] = shades.get(shade, 0) + 1
                else:
                    name = g_names[i] if i < len(g_names) else ""
                    if name:
                        item_companions.append(name)
        if found:
            matching.append({
                "image_url": p.payload.get("image_url", ""),
                "image_id": p.payload.get("image_id", ""),
                "brand": p.payload.get("brand", ""),
                "style": p.payload.get("style", ""),
            })
            for cc in item_companions:
                companions[cc] = companions.get(cc, 0) + 1

    return json.dumps({
        "target_color": color,
        "total_matching_images": len(matching),
        "color_shades": [{"name": n, "count": c} for n, c in sorted(shades.items(), key=lambda x: -x[1])[:15]],
        "companion_colors": [{"name": n, "count": c} for n, c in sorted(companions.items(), key=lambda x: -x[1])[:15]],
        "sample_images": matching[:20],
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: analyze_trends
# ═══════════════════════════════════════════════════════════════

@tool
def analyze_trends(
    dimension: Optional[str],
    categories: Optional[list[str]] = None,
    fabric: Optional[str] = None,
    color: Optional[str] = None,
    pattern: Optional[str] = None,
    silhouette: Optional[str] = None,
    brand: Optional[str] = None,
    season: Optional[list[str]] = None,
    year_min: Optional[int] = None,
    top_n: int = 30,
    search: Optional[str] = None,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Analyze TRENDS and statistics. Counts and ranks — does NOT search images.

    Args:
        dimension: Which attribute to analyze. Supported values:
            Garment-level: "color", "fabric", "pattern", "silhouette",
                          "sleeve_length", "garment_length", "collar"
            Image-level:   "brand", "style", "category", "season", "year", "gender"
        categories, fabric, color, pattern, silhouette, brand, season, year_min: Optional filters
        top_n: How many top values to return (default 30, increase for rare labels)
        search: Optional fuzzy search term — only show values containing this text.
            Example: search="hound" will match "houndstooth", "hound's tooth", etc.
    """
    thread_id = get_thread_id(config) if config else ""
    dimension = (_normalize_optional_tool_string(dimension) or "").lower()
    brand = _normalize_optional_tool_string(brand)
    search = _normalize_optional_tool_string(search)

    if not dimension and thread_id and _should_autobind_brand_dimension(thread_id, value=search, brand=brand):
        dimension = "brand"

    if not dimension:
        return _structured_argument_error(
            dimension="",
            value=search or brand,
            reason="Trend analysis dimension must be a non-empty string.",
        )

    collection = get_collection()
    client = get_qdrant()

    qdrant_filter = build_qdrant_filter(categories=categories, brand=brand, season=season, year_min=year_min)

    tag_conditions = []
    if categories:
        for cat in categories:
            cat = cat.lower()
            if fabric:
                tag_conditions.append(f"{cat}:{fabric.lower()}")
            if color:
                tag_conditions.append(f"{cat}:{color.lower()}")
            if pattern:
                tag_conditions.append(f"{cat}:{pattern.lower()}")
            if silhouette:
                tag_conditions.append(f"{cat}:{silhouette.lower()}")

    if tag_conditions:
        cond = FieldCondition(key="garment_tags", match=MatchAny(any=tag_conditions))
        if qdrant_filter:
            qdrant_filter.must.append(cond)
        else:
            qdrant_filter = Filter(must=[cond])

    pts = scroll_all(client, collection, scroll_filter=qdrant_filter)

    IMAGE_DIMS = {"brand", "style", "gender"}
    GARMENT_SIMPLE_DIMS = {"fabric", "pattern", "silhouette", "collar"}
    GARMENT_NESTED_MAP = {"sleeve_length": "sleeve", "garment_length": "length"}

    counter: dict[str, int] = {}
    for p in pts:
        if dimension in IMAGE_DIMS:
            v = p.payload.get(dimension, "")
            if v:
                counter[v] = counter.get(v, 0) + 1
        elif dimension == "category":
            for cat in p.payload.get("categories", []):
                counter[cat] = counter.get(cat, 0) + 1
        elif dimension == "season":
            seasons = p.payload.get("season", [])
            if isinstance(seasons, list):
                for s in seasons:
                    if s:
                        counter[s] = counter.get(s, 0) + 1
            elif seasons:
                counter[seasons] = counter.get(seasons, 0) + 1
        elif dimension == "year":
            yr = p.payload.get("year", 0)
            if yr:
                key = str(yr)
                counter[key] = counter.get(key, 0) + 1
        elif dimension == "color":
            for g in p.payload.get("garments", []):
                for c in g.get("colors", []):
                    n = c.get("name", "")
                    if n:
                        counter[n] = counter.get(n, 0) + 1
        elif dimension in GARMENT_SIMPLE_DIMS:
            for g in p.payload.get("garments", []):
                v = g.get(dimension, "")
                if v:
                    counter[v] = counter.get(v, 0) + 1
        elif dimension in GARMENT_NESTED_MAP:
            field = GARMENT_NESTED_MAP[dimension]
            for g in p.payload.get("garments", []):
                v = g.get(field, "")
                if v:
                    counter[v] = counter.get(v, 0) + 1

    if search:
        search_lower = search.lower()
        counter = {k: v for k, v in counter.items() if search_lower in k.lower()}

    ranked = sorted(counter.items(), key=lambda x: -x[1])[:top_n]
    total = max(sum(counter.values()), 1)
    return json.dumps({
        "dimension": dimension,
        "total_items_analyzed": len(pts),
        "total_unique_values": len(counter),
        "search": search,
        "ranking": [{"name": n, "count": c, "percentage": f"{c/total*100:.1f}%"} for n, c in ranked],
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: get_image_details
# ═══════════════════════════════════════════════════════════════

@tool
def get_image_details(image_id: str) -> str:
    """Get full details of a specific image by its ID."""
    collection = get_collection()
    client = get_qdrant()
    results = client.scroll(
        collection,
        scroll_filter=Filter(must=[FieldCondition(key="image_id", match=MatchValue(value=image_id))]),
        limit=1, with_payload=True,
    )
    if not results[0]:
        return json.dumps({"error": f"Image {image_id} not found"})
    return json.dumps(results[0][0].payload, ensure_ascii=False, default=str)


# ── Export ──
ALL_TOOLS = [
    search_style,
    fashion_vision,
    start_collection, add_filter, remove_filter, peek_collection, show_collection,
    explore_colors, analyze_trends, get_image_details,
]
