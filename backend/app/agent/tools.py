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
import time
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
    iter_scroll,
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
    get_runtime_plan,
    get_turn_context,
    note_invalid_filter_attempt,
    clear_invalid_filter_attempt,
    update_session_semantics,
)
from .color_utils import COLOR_KEYWORDS, color_matches
from ..services.chat_service import create_artifact, set_session_agent_runtime
from ..services.chat_run_registry import ChatRunCancelledError, chat_run_registry
from ..services.fashion_vision_service import (
    analyze_fashion_images,
    FashionVisionError,
    generate_style_retrieval_query,
)
from ..services.style_knowledge_service import search_style_knowledge
from ..services.style_feedback_service import record_style_gap_feedback
from ..value_normalization import normalize_quarter_list, normalize_quarter_value, normalize_string_list_value
from .query_context import get_query_context, average_embeddings, get_session_image_blocks
from .query_context import remember_session_style, remember_session_vision, set_query_context, merge_query_contexts
from ..config import settings

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


def _run_id_from_config(config: RunnableConfig | None) -> str | None:
    if not config:
        return None
    configurable = config.get("configurable", {})
    run_id = configurable.get("run_id")
    return str(run_id) if run_id else None


def _ensure_run_active(config: RunnableConfig | None, *, stage: str) -> None:
    chat_run_registry.raise_if_stop_requested(
        run_id=_run_id_from_config(config),
        session_id=_session_id_from_config(config),
        stage=stage,
    )


def _cancel_check_from_config(config: RunnableConfig | None, *, stage: str):
    return lambda: _ensure_run_active(config, stage=stage)


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
                "runtime_plan": get_runtime_plan(thread_id) or {},
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
                "runtime_plan": get_runtime_plan(thread_id) or {},
            },
        )
    except Exception:
        return


def _runtime_plan_filter_entries(thread_id: str) -> list[dict]:
    plan = get_runtime_plan(thread_id) or {}
    entries: list[dict] = []
    for item in plan.get("hard_filters", []):
        if not isinstance(item, dict):
            continue
        dimension = str(item.get("dimension", "")).strip().lower()
        value = item.get("value")
        if not dimension or value in (None, ""):
            continue
        if dimension == "category":
            entry = {"type": "category", "key": "category", "value": str(value).strip().lower()}
        elif dimension in {"brand", "gender", "quarter", "year_min", "image_type"}:
            entry = {"type": "meta", "key": dimension, "value": value}
        else:
            continue
        if entry not in entries:
            entries.append(entry)
    return entries


def _current_runtime_policy(thread_id: str) -> dict:
    plan = get_runtime_plan(thread_id) or {}
    policy = plan.get("policy_flags", {})
    return dict(policy) if isinstance(policy, dict) else {}


def _current_runtime_next_step(thread_id: str) -> str:
    plan = get_runtime_plan(thread_id) or {}
    return str(plan.get("next_step_hint", "")).strip()


def _current_runtime_blocked_tools(thread_id: str) -> set[str]:
    plan = get_runtime_plan(thread_id) or {}
    return {
        str(item).strip()
        for item in plan.get("blocked_tools", [])
        if str(item).strip()
    }


def _format_runtime_seeded_filters(entries: list[dict]) -> list[str]:
    return [_format_filter_entry(item) for item in entries]


def _tool_routing_error(
    *,
    tool_name: str,
    reason: str,
    suggested_next_actions: list[str],
    suggested_strategy: str,
) -> str:
    return json.dumps({
        "error": reason,
        "message": reason,
        "error_type": "strategy_mismatch",
        "tool": tool_name,
        "retry_same_call": False,
        "suggested_strategy": suggested_strategy,
        "suggested_next_actions": suggested_next_actions,
    }, ensure_ascii=False)


def _post_collection_next_step(thread_id: str, *, style_retrieval_query: str = "") -> str:
    next_step = _current_runtime_next_step(thread_id)
    if next_step == "start_collection_then_add_brand_filter":
        return "add_brand_filter"
    if next_step == "start_collection":
        return "show_collection" if style_retrieval_query else "add_filter"
    if next_step:
        return next_step
    return "show_collection" if style_retrieval_query else "add_filter"


def _compose_semantic_grounding_text(query_context: dict) -> str:
    style_rich_text = str(query_context.get("style_rich_text", "")).strip()
    style_retrieval_query = str(query_context.get("style_retrieval_query", "")).strip()
    vision_retrieval_query = str(query_context.get("vision_retrieval_query", "")).strip()

    parts: list[str] = []
    if style_rich_text:
        parts.append(style_rich_text)
    elif style_retrieval_query:
        parts.append(style_retrieval_query)
    if vision_retrieval_query:
        parts.append(f"vision_reference: {vision_retrieval_query}")
    return "\n".join(part for part in parts if part).strip()


def _normalize_vector(vector: list[float]) -> list[float]:
    norm = sum(value * value for value in vector) ** 0.5
    if norm < 1e-9:
        return vector
    return [value / norm for value in vector]


_TREND_FACET_KEYS = {
    "brand": "brand",
    "category": "categories",
    "style": "style",
    "gender": "gender",
    "quarter": "quarter",
    "year": "year",
}

_TREND_CACHE_TTL_SECONDS = 300
_TREND_CACHE_MAX_SIZE = 256
_trend_cache: dict[str, tuple[float, str]] = {}

_TREND_PAYLOAD_SELECTORS = {
    "style": ["style"],
    "gender": ["gender"],
    "quarter": ["quarter"],
    "year": ["year"],
    "color": ["garments"],
    "fabric": ["garments"],
    "pattern": ["garments"],
    "silhouette": ["garments"],
    "collar": ["garments"],
    "sleeve_length": ["garments"],
    "garment_length": ["garments"],
}


def _normalize_trend_value(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _canonicalize_temporal_dimension(value: str | None) -> str:
    normalized = (_normalize_optional_tool_string(value) or "").lower()
    return normalized


def _format_filter_entry(filter_item: dict) -> str:
    if filter_item["type"] == "category":
        return f"category={filter_item['value']}"
    if filter_item["type"] == "garment_tag":
        return f"{filter_item['key']}={filter_item['value'].split(':')[1]}"

    key = str(filter_item.get("key", "")).strip()
    value = filter_item.get("value", "")
    if key == "quarter":
        normalized = normalize_quarter_value(value)
        if normalized:
            value = normalized
    return f"{key}={value}"


def _build_trend_cache_key(
    *,
    dimension: str,
    categories: Optional[list[str]],
    fabric: Optional[str],
    color: Optional[str],
    pattern: Optional[str],
    silhouette: Optional[str],
    brand: Optional[str],
    quarter: Optional[list[str]],
    year_min: Optional[int],
    top_n: int,
    search: Optional[str],
) -> str:
    payload = {
        "dimension": dimension,
        "categories": sorted([c.lower() for c in (categories or [])]),
        "fabric": (fabric or "").lower(),
        "color": (color or "").lower(),
        "pattern": (pattern or "").lower(),
        "silhouette": (silhouette or "").lower(),
        "brand": (brand or "").lower(),
        "quarter": normalize_quarter_list(quarter),
        "year_min": year_min,
        "top_n": top_n,
        "search": (search or "").lower(),
    }
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def _get_cached_trend_result(cache_key: str) -> str | None:
    entry = _trend_cache.get(cache_key)
    if entry is None:
        return None
    expires_at, payload = entry
    if expires_at < time.monotonic():
        _trend_cache.pop(cache_key, None)
        return None
    return payload


def _store_cached_trend_result(cache_key: str, payload: str) -> None:
    if len(_trend_cache) >= _TREND_CACHE_MAX_SIZE:
        oldest_key = min(_trend_cache.items(), key=lambda item: item[1][0])[0]
        _trend_cache.pop(oldest_key, None)
    _trend_cache[cache_key] = (time.monotonic() + _TREND_CACHE_TTL_SECONDS, payload)


def _count_trend_values_from_payload(
    counter: dict[str, int],
    *,
    payload: dict,
    dimension: str,
) -> None:
    image_dims = {"brand", "style", "gender"}
    garment_simple_dims = {"fabric", "pattern", "silhouette", "collar"}
    garment_nested_map = {"sleeve_length": "sleeve", "garment_length": "length"}

    if dimension in image_dims:
        value = _normalize_trend_value(payload.get(dimension))
        if value:
            counter[value] = counter.get(value, 0) + 1
        return

    if dimension == "category":
        for category in payload.get("categories", []) or []:
            value = _normalize_trend_value(category)
            if value:
                counter[value] = counter.get(value, 0) + 1
        return

    if dimension == "quarter":
        quarter_value = normalize_quarter_value(payload.get("quarter"))
        if quarter_value:
            counter[quarter_value] = counter.get(quarter_value, 0) + 1
        return

    if dimension == "year":
        value = payload.get("year")
        if value:
            normalized = _normalize_trend_value(value)
            if normalized:
                counter[normalized] = counter.get(normalized, 0) + 1
        return

    garments = payload.get("garments", []) or []
    if dimension == "color":
        for garment in garments:
            for color_value in garment.get("colors", []) or []:
                value = _normalize_trend_value(color_value.get("name"))
                if value:
                    counter[value] = counter.get(value, 0) + 1
        return

    if dimension in garment_simple_dims:
        for garment in garments:
            value = _normalize_trend_value(garment.get(dimension))
            if value:
                counter[value] = counter.get(value, 0) + 1
        return

    if dimension in garment_nested_map:
        field = garment_nested_map[dimension]
        for garment in garments:
            value = _normalize_trend_value(garment.get(field))
            if value:
                counter[value] = counter.get(value, 0) + 1


def _facet_trend_counts(
    *,
    client,
    collection: str,
    qdrant_filter,
    dimension: str,
    top_n: int,
    cancel_check=None,
) -> tuple[dict[str, int], int] | None:
    facet_key = _TREND_FACET_KEYS.get(dimension)
    if not facet_key:
        return None

    try:
        if cancel_check:
            cancel_check()
        response = client.facet(
            collection_name=collection,
            key=facet_key,
            facet_filter=qdrant_filter,
            limit=max(100, top_n * 8),
            exact=False,
        )

        counter: dict[str, int] = {}
        for hit in response.hits:
            value = _normalize_trend_value(hit.value)
            if value:
                counter[value] = int(hit.count)

        if cancel_check:
            cancel_check()
        total_items = client.count(
            collection_name=collection,
            count_filter=qdrant_filter,
            exact=False,
        ).count
        if cancel_check:
            cancel_check()
        return counter, int(total_items)
    except Exception:
        return None


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
            "quarter": hard_filters.get("quarter", []),
        },
        "follow_up_questions_zh": merged.get("follow_up_questions_zh", []),
    }


def _extract_vision_semantic_context(analysis: dict) -> dict[str, object]:
    compact = _compact_fashion_vision_result(analysis)
    hard_filters = compact.get("hard_filters", {}) if isinstance(compact.get("hard_filters"), dict) else {}
    categories = [
        str(item).strip().lower()
        for item in hard_filters.get("category", [])
        if str(item).strip()
    ]
    unique_categories = list(dict.fromkeys(categories))
    return {
        "vision_retrieval_query": str(compact.get("retrieval_query_en", "")).strip(),
        "vision_summary_zh": str(compact.get("summary_zh", "")).strip(),
        "vision_primary_category": unique_categories[0] if len(unique_categories) == 1 else "",
        "vision_categories": unique_categories,
    }


def _run_coro_sync(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(asyncio.run, coro)
        return future.result()


def _semantic_style_score(payload: dict[str, object]) -> float | None:
    primary_style = payload.get("primary_style", {}) if isinstance(payload.get("primary_style"), dict) else {}
    raw_score = primary_style.get("score")
    try:
        if raw_score in (None, ""):
            return None
        return float(raw_score)
    except (TypeError, ValueError):
        return None


def _style_query_fallback_reason(payload: dict[str, object]) -> str | None:
    status = str(payload.get("status", "")).strip().lower()
    if status == "not_found":
        return "style_not_found"

    if status != "ok":
        return None

    if str(payload.get("search_stage", "")).strip().lower() != "semantic":
        return None

    score = _semantic_style_score(payload)
    if score is None:
        return "semantic_score_missing"
    if score < settings.STYLE_KNOWLEDGE_LOW_SCORE_FALLBACK_THRESHOLD:
        return "semantic_score_below_threshold"
    return None


def _maybe_generate_style_fallback_query(
    *,
    payload: dict[str, object],
    query: str,
    config: RunnableConfig | None,
) -> tuple[dict[str, object], bool]:
    fallback_reason = _style_query_fallback_reason(payload)
    if not fallback_reason:
        return payload, False

    thread_id = get_thread_id(config) if config else ""
    image_blocks = get_session_image_blocks(thread_id) if thread_id else []
    primary_style = payload.get("primary_style", {}) if isinstance(payload.get("primary_style"), dict) else {}
    style_reference = None
    if primary_style:
        style_reference = {
            "style_name": str(primary_style.get("style_name", "")).strip(),
            "score": _semantic_style_score(payload),
            "style_rich_text": str(payload.get("rich_text", "")).strip(),
        }

    try:
        generated = _run_coro_sync(generate_style_retrieval_query(
            user_request=query,
            image_blocks=image_blocks,
            style_reference=style_reference,
        ))
    except Exception as exc:
        next_payload = dict(payload)
        next_payload["generated_retrieval_query"] = {
            "source": "vlm_fallback",
            "fallback_reason": fallback_reason,
            "error": str(exc),
        }
        return next_payload, False

    next_payload = dict(payload)
    retrieval_plan = dict(next_payload.get("retrieval_plan", {}) if isinstance(next_payload.get("retrieval_plan"), dict) else {})
    retrieval_plan["retrieval_query_en"] = str(generated.get("retrieval_query_en", "")).strip()
    retrieval_plan["style_rich_text"] = str(generated.get("style_rich_text", "")).strip()
    retrieval_plan["query_generation_source"] = "vlm_fallback"
    retrieval_plan["fallback_reason"] = fallback_reason
    next_payload["retrieval_plan"] = retrieval_plan
    next_payload["rich_text"] = str(generated.get("style_rich_text", "")).strip()

    execution_hint = dict(next_payload.get("execution_hint", {}) if isinstance(next_payload.get("execution_hint"), dict) else {})
    execution_hint["preferred_collection_query_source"] = "retrieval_plan.retrieval_query_en"
    execution_hint["auto_ground_generated_query"] = True
    next_payload["execution_hint"] = execution_hint

    next_payload["generated_retrieval_query"] = {
        "source": "vlm_fallback",
        "fallback_reason": fallback_reason,
        "model": str(generated.get("model", "")).strip(),
        "summary": str(generated.get("summary", "")).strip(),
    }

    original_hint = str(next_payload.get("agent_hint", "")).strip()
    next_payload["agent_hint"] = (
        "Use the generated retrieval_query_en as the primary execution payload for semantic retrieval. "
        "Treat any low-confidence style-library match only as weak background reference."
    ) + (f" {original_hint}" if original_hint else "")
    return next_payload, True


@tool
def fashion_vision(
    user_request: str = "",
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Analyze the session's latest uploaded image(s) with a fashion-focused VLM.

    Use this whenever the user's request depends on understanding uploaded images.
    The tool returns compact structured JSON optimized for retrieval planning.
    """
    _ensure_run_active(config, stage="fashion_vision:start")
    thread_id = get_thread_id(config)
    image_blocks = get_session_image_blocks(thread_id)
    if not image_blocks:
        return json.dumps({
            "ok": False,
            "error": "No uploaded images found in the current session.",
        }, ensure_ascii=False)

    try:
        _ensure_run_active(config, stage="fashion_vision:before_analysis")
        analysis = _run_coro_sync(analyze_fashion_images(image_blocks, user_request=user_request))
        _ensure_run_active(config, stage="fashion_vision:after_analysis")
    except ChatRunCancelledError:
        raise
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

    vision_context = _extract_vision_semantic_context(analysis)
    vision_retrieval_query = str(vision_context.get("vision_retrieval_query", "")).strip()
    vision_summary_zh = str(vision_context.get("vision_summary_zh", "")).strip()
    vision_primary_category = str(vision_context.get("vision_primary_category", "")).strip().lower()
    recommended_next_step = "start_collection"
    if vision_primary_category:
        recommended_next_step = "start_collection"

    if config and (vision_retrieval_query or vision_summary_zh or vision_primary_category):
        remember_session_vision(
            thread_id,
            vision_retrieval_query=vision_retrieval_query,
            vision_summary_zh=vision_summary_zh,
            vision_primary_category=vision_primary_category,
        )
        set_query_context(
            thread_id,
            merge_query_contexts(
                get_query_context(thread_id),
                {
                    "vision_retrieval_query": vision_retrieval_query,
                    "vision_summary_zh": vision_summary_zh,
                    "vision_primary_category": vision_primary_category,
                },
            ),
        )
        update_session_semantics(
            thread_id=thread_id,
            explicit_category=vision_primary_category or None,
            vision_retrieval_query=vision_retrieval_query or None,
            vision_summary_zh=vision_summary_zh or None,
        )
        _persist_runtime_semantics(config=config, thread_id=thread_id)

    return json.dumps({
        "ok": True,
        "artifact_id": artifact_id,
        "image_count": len(image_blocks),
        "model": analysis.get("model", ""),
        "recommended_next_step": recommended_next_step,
        "vision_primary_category": vision_primary_category or None,
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
    - optional concrete filters with lower failure risk

    Typical next step:
    1. call search_style(query)
    2. use retrieval_plan.retrieval_query_en to call start_collection(...)
    3. inspect/show the style-grounded pool first
    4. only then add high-confidence concrete filters if needed
    """
    _ensure_run_active(config, stage="search_style:start")
    try:
        payload = search_style_knowledge(query, limit=max(1, min(limit, 5)))
        _ensure_run_active(config, stage="search_style:after_lookup")
        payload, generated_query_applied = _maybe_generate_style_fallback_query(
            payload=dict(payload),
            query=query,
            config=config,
        )
        _ensure_run_active(config, stage="search_style:after_fallback")
    except ChatRunCancelledError:
        raise
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

    status = str(payload.get("status", "")).strip().lower()

    if config and status in {"ok", "not_found"}:
        thread_id = get_thread_id(config)
        primary_style = payload.get("primary_style", {}) if isinstance(payload.get("primary_style"), dict) else {}
        retrieval_plan = payload.get("retrieval_plan", {}) if isinstance(payload.get("retrieval_plan"), dict) else {}
        style_retrieval_query = str(retrieval_plan.get("retrieval_query_en", "")).strip()
        style_rich_text = str(retrieval_plan.get("style_rich_text", "")).strip() or str(payload.get("rich_text", "")).strip()
        style_name = "" if generated_query_applied else str(primary_style.get("style_name", "")).strip()
        match_confidence = str(payload.get("match_confidence", "") or "").strip().lower()
        should_auto_ground = generated_query_applied or status == "not_found" or match_confidence != "candidate"

        if should_auto_ground and (style_retrieval_query or style_rich_text):
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

        if should_auto_ground:
            update_session_semantics(
                thread_id=thread_id,
                explicit_style_name=style_name or None,
                style_retrieval_query=style_retrieval_query or None,
                style_rich_text=style_rich_text or None,
            )
        _persist_runtime_semantics(config=config, thread_id=thread_id)

    if payload.get("status") == "not_found":
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
    _ensure_run_active(config, stage="start_collection:start")
    client = get_qdrant()
    cancel_check = _cancel_check_from_config(config, stage="start_collection:compute")

    thread_id = get_thread_id(config)
    query_context = get_query_context(thread_id) or {}
    image_vectors = query_context.get("image_embeddings", [])
    image_vector = average_embeddings(image_vectors) if image_vectors else None
    style_retrieval_query = str(query_context.get("style_retrieval_query", "")).strip()
    vision_retrieval_query = str(query_context.get("vision_retrieval_query", "")).strip()
    runtime_seed_filters = _runtime_plan_filter_entries(thread_id)

    text_vector = encode_text(query, cancel_check=cancel_check) if query else None
    style_semantic_text = _compose_semantic_grounding_text(query_context)
    style_vector = encode_text(style_semantic_text, cancel_check=cancel_check) if style_semantic_text else None
    fused_vector = _fuse_query_vectors(
        text_vector=text_vector,
        style_vector=style_vector,
        image_vector=image_vector,
    )
    if fused_vector is not None:
        fused_vector = apply_aesthetic_boost(fused_vector)

    effective_query = query or style_retrieval_query or vision_retrieval_query

    session = {
        "query": effective_query,
        "vector_type": "fashion_clip",
        "q_emb": fused_vector,
        "filters": runtime_seed_filters,
        "active": True,
    }

    set_session(config, session)
    _persist_agent_runtime_state(config=config, thread_id=thread_id, session=session)
    count = count_session(client, session, cancel_check=cancel_check)
    seeded_filter_summary = _format_runtime_seeded_filters(runtime_seed_filters)
    recommended_next_step = _post_collection_next_step(
        thread_id,
        style_retrieval_query=style_retrieval_query,
    )
    return json.dumps({
        "status": "collection_started",
        "total": count,
        "query": effective_query or "(all images)",
        "style_retrieval_query": style_retrieval_query or None,
        "vision_retrieval_query": vision_retrieval_query or None,
        "seeded_filters": seeded_filter_summary,
        "recommended_next_step": recommended_next_step,
        "message": (
            f"Collection started with {count} images. Use add_filter to narrow down."
            if not image_vectors and not style_retrieval_query and not vision_retrieval_query
            else (
                f"Collection started with {count} images using {len(image_vectors)} uploaded image(s). Use add_filter to narrow down."
                if image_vectors and not style_retrieval_query and not vision_retrieval_query
                else (
                    f"Collection started with {count} images using semantic grounding. Inspect or show this pool first; only add filters if the user explicitly wants tighter precision or the pool is still too broad."
                    if (style_retrieval_query or vision_retrieval_query) and not image_vectors
                    else (
                        f"Collection started with {count} images using {len(image_vectors)} uploaded image(s) and semantic grounding. "
                        "Inspect or show this pool first; only add filters if the user explicitly wants tighter precision or the pool is still too broad."
                    )
                )
            )
        ) + (
            f" Default hard filters applied: {', '.join(seeded_filter_summary)}."
            if seeded_filter_summary
            else ""
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
    - If dimension is an image attribute (brand, gender, quarter, year_min, image_type), DO NOT pass `category`.

    Returns: remaining count. If 0, suggests available values — DO NOT add this filter.
    """
    _ensure_run_active(config, stage="add_filter:start")
    session = get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()
    thread_id = get_thread_id(config)
    cancel_check = _cancel_check_from_config(config, stage="add_filter:compute")

    dimension = _canonicalize_temporal_dimension(dimension)
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
    if dimension == "quarter":
        value = normalize_quarter_value(value)
        if value is None:
            return _structured_argument_error(
                dimension="quarter",
                value="",
                reason='Filter "quarter" requires a valid quarter value such as 早春 / 春夏 / 早秋 / 秋冬 / Resort / SS / FW.',
            )

    GARMENT_TAG_DIMS = {"color", "fabric", "pattern", "silhouette"}
    GARMENT_NESTED_DIMS = {"sleeve_length", "sleeve", "garment_length", "length", "collar"}
    meta_dims = {"brand", "gender", "quarter", "year_min", "image_type"}
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
    # Validation must use an exact count. Qdrant's approximate count is fast, but
    # it can over-report matches for nested garment filters and falsely accept
    # impossible add_filter requests.
    count = count_session(client, test_session, cancel_check=cancel_check, exact=True)

    if count > 0:
        clear_invalid_filter_attempt(
            thread_id=thread_id,
            dimension=dimension,
            value=value,
            category=category,
        )
        policy = _current_runtime_policy(thread_id)
        if policy.get("duplicate_filters_are_noop") and entry in session["filters"]:
            remaining = count_session(
                client,
                session,
                cancel_check=cancel_check,
                exact=True,
            )
            _persist_agent_runtime_state(config=config, thread_id=thread_id, session=session)
            filter_summary = [_format_filter_entry(f) for f in session["filters"]]
            return json.dumps({
                "action": "filter_already_active",
                "filter": f"{dimension}={value}" + (f" (on {category})" if category else ""),
                "remaining": remaining,
                "active_filters": filter_summary,
                "message": f"{dimension}={value} is already active. Keeping the current collection unchanged.",
                "resolved_category": inferred_category,
            })
        session["filters"].append(entry)
        set_session(config, session)
        _persist_agent_runtime_state(config=config, thread_id=thread_id, session=session)
        filter_summary = [_format_filter_entry(f) for f in session["filters"]]

        return json.dumps({
            "action": "filter_added",
            "filter": f"{dimension}={value}" + (f" (on {category})" if category else ""),
            "remaining": count,
            "active_filters": filter_summary,
            "message": f"Added {dimension}={value}. {count} images remaining.",
            "resolved_category": inferred_category,
        })
    else:
        available = available_values(client, dimension, category, session["filters"], cancel_check=cancel_check)
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
    _ensure_run_active(config, stage="remove_filter:start")
    session = get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection."})

    client = get_qdrant()
    cancel_check = _cancel_check_from_config(config, stage="remove_filter:compute")

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
    count = count_session(client, session, cancel_check=cancel_check, exact=False)

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
    _ensure_run_active(config, stage="peek_collection:start")
    session = get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()
    cancel_check = _cancel_check_from_config(config, stage="peek_collection:compute")
    total = count_session(client, session, cancel_check=cancel_check)
    results = get_session_page(client, session, offset=0, limit=limit, cancel_check=cancel_check)

    peek_results = []
    for index, p in enumerate(results):
        if index % 4 == 0:
            cancel_check()
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
            "quarter": normalize_quarter_value(p.payload.get("quarter")) or "",
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
    _ensure_run_active(config, stage="show_collection:start")
    session = get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()
    cancel_check = _cancel_check_from_config(config, stage="show_collection:compute")
    count = count_session(client, session, cancel_check=cancel_check)

    filter_summary = [_format_filter_entry(f) for f in session["filters"]]
    thread_id = get_thread_id(config) if config else ""

    serializable_session = _serialize_search_session(session)
    session_id = _session_id_from_config(config)

    search_request_id = None
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
        "query": str(session.get("query", "") or ""),
        "filters_applied": filter_summary,
        "recommended_next_step": _current_runtime_next_step(thread_id) or "done",
        "message": f"Showing {count} matching images in paginated results. Filters applied: {len(filter_summary)}.",
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: explore_colors
# ═══════════════════════════════════════════════════════════════

@tool
def explore_colors(
    color: str,
    categories: Optional[list[str] | str] = None,
    brand: Optional[str] = None,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Explore images by COLOR FAMILY. Reports companion colors and shade distribution.

    Args:
        color: Color keyword. "red", "green", "navy", "burgundy" etc.
        categories: Optional garment type filter
        brand: Optional brand filter
    """
    _ensure_run_active(config, stage="explore_colors:start")
    collection = get_collection()
    client = get_qdrant()
    cancel_check = _cancel_check_from_config(config, stage="explore_colors:compute")
    normalized_categories = [item.lower() for item in normalize_string_list_value(categories)]
    qdrant_filter = build_qdrant_filter(categories=normalized_categories, brand=brand)
    pts = scroll_all(client, collection, scroll_filter=qdrant_filter, cancel_check=cancel_check)

    refs = COLOR_KEYWORDS.get(color.lower())
    if not refs:
        return json.dumps({"error": f"Unknown color: {color}. Supported: {list(COLOR_KEYWORDS.keys())}"})

    matching = []
    shades: dict[str, int] = {}
    companions: dict[str, int] = {}

    for index, p in enumerate(pts):
        if index % 50 == 0:
            cancel_check()
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
        "results": matching[:20],
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: analyze_trends
# ═══════════════════════════════════════════════════════════════

@tool
def analyze_trends(
    dimension: Optional[str],
    categories: Optional[list[str] | str] = None,
    fabric: Optional[str] = None,
    color: Optional[str] = None,
    pattern: Optional[str] = None,
    silhouette: Optional[str] = None,
    brand: Optional[str] = None,
    quarter: Optional[list[str] | str] = None,
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
            Image-level:   "brand", "style", "category", "quarter", "year", "gender"
        categories, fabric, color, pattern, silhouette, brand, quarter, year_min: Optional filters
        top_n: How many top values to return (default 30, increase for rare labels)
        search: Optional fuzzy search term — only show values containing this text.
            Example: search="hound" will match "houndstooth", "hound's tooth", etc.
    """
    _ensure_run_active(config, stage="analyze_trends:start")
    thread_id = get_thread_id(config) if config else ""
    cancel_check = _cancel_check_from_config(config, stage="analyze_trends:compute")
    dimension = _canonicalize_temporal_dimension(dimension)
    normalized_categories = [item.lower() for item in normalize_string_list_value(categories)]
    brand = _normalize_optional_tool_string(brand)
    search = _normalize_optional_tool_string(search)
    normalized_quarters = normalize_quarter_list(quarter)

    if not dimension and thread_id and _should_autobind_brand_dimension(thread_id, value=search, brand=brand):
        dimension = "brand"

    if not dimension:
        return _structured_argument_error(
            dimension="",
            value=search or brand,
            reason="Trend analysis dimension must be a non-empty string.",
        )

    garment_dims = {"color", "fabric", "pattern", "silhouette", "sleeve_length", "garment_length", "collar"}
    active_category = infer_active_category(
        thread_id=thread_id,
        session_filters=get_session(config).get("filters", []) if config else [],
    ) if thread_id else None
    blocked_tools = _current_runtime_blocked_tools(thread_id) if thread_id else set()
    runtime_policy = _current_runtime_policy(thread_id) if thread_id else {}

    if "analyze_trends" in blocked_tools and runtime_policy.get("brand_focus_skips_trend_analysis"):
        suggested_brand = brand or search or "<brand-name>"
        session_active = bool(get_session(config).get("active")) if config else False
        suggested_actions = (
            [f'add_filter("brand", "{suggested_brand}")', "show_collection()"]
            if session_active
            else ['start_collection("")', f'add_filter("brand", "{suggested_brand}")']
        )
        return _tool_routing_error(
            tool_name="analyze_trends",
            reason=(
                "Current runtime plan is a single-brand retrieval flow. Trend analysis is intentionally skipped "
                "because the next deterministic step should be a direct brand filter."
            ),
            suggested_next_actions=suggested_actions,
            suggested_strategy=(
                "Use direct brand filtering instead of exploratory trend counting when the user's intent is 'only this brand'."
            ),
        )

    if (
        dimension in garment_dims
        and not normalized_categories
        and not active_category
        and runtime_policy.get("image_query_requires_semantic_start_before_garment_trends")
    ):
        return _tool_routing_error(
            tool_name="analyze_trends",
            reason=(
                f'Garment trend analysis for "{dimension}" is blocked until a single garment category is resolved. '
                "For image-led queries, start semantic retrieval first, then analyze or filter within the resolved category."
            ),
            suggested_next_actions=[
                'start_collection("<image-grounded semantic query>")',
                'add_filter("category", "<garment-category>")',
            ],
            suggested_strategy=(
                "Resolve the retrieval pool or garment category first; otherwise garment-level trend counts are too noisy."
            ),
        )

    cache_key = _build_trend_cache_key(
        dimension=dimension,
        categories=normalized_categories,
        fabric=fabric,
        color=color,
        pattern=pattern,
        silhouette=silhouette,
        brand=brand,
        quarter=normalized_quarters,
        year_min=year_min,
        top_n=top_n,
        search=search,
    )
    cached_payload = _get_cached_trend_result(cache_key)
    if cached_payload is not None:
        return cached_payload

    collection = get_collection()
    client = get_qdrant()

    qdrant_filter = build_qdrant_filter(
        categories=normalized_categories,
        brand=brand,
        quarter=normalized_quarters,
        year_min=year_min,
    )

    tag_conditions = []
    if normalized_categories:
        for cat in normalized_categories:
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

    counter: dict[str, int] = {}
    items_analyzed = 0
    facet_result = None if search else _facet_trend_counts(
        client=client,
        collection=collection,
        qdrant_filter=qdrant_filter,
        dimension=dimension,
        top_n=top_n,
        cancel_check=cancel_check,
    )

    if facet_result is not None:
        counter, items_analyzed = facet_result
    else:
        payload_selector = _TREND_PAYLOAD_SELECTORS.get(dimension, True)
        for point in iter_scroll(
            client,
            collection,
            scroll_filter=qdrant_filter,
            with_payload=payload_selector,
            cancel_check=cancel_check,
        ):
            items_analyzed += 1
            _count_trend_values_from_payload(
                counter,
                payload=point.payload or {},
                dimension=dimension,
            )

    if search:
        search_lower = search.lower()
        counter = {k: v for k, v in counter.items() if search_lower in k.lower()}

    ranked = sorted(counter.items(), key=lambda x: -x[1])[:top_n]
    total = max(sum(counter.values()), 1)
    payload = json.dumps({
        "dimension": dimension,
        "total_items_analyzed": items_analyzed,
        "total_unique_values": len(counter),
        "search": search,
        "ranking": [{"name": n, "count": c, "percentage": f"{c/total*100:.1f}%"} for n, c in ranked],
    }, ensure_ascii=False)
    _store_cached_trend_result(cache_key, payload)
    return payload


# ═══════════════════════════════════════════════════════════════
#  Tool: get_image_details
# ═══════════════════════════════════════════════════════════════

@tool
def get_image_details(
    image_id: str,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Get full details of a specific image by its ID."""
    _ensure_run_active(config, stage="get_image_details:start")
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
