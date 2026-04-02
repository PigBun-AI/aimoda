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
    available_values,
)
from .harness import (
    infer_active_category,
    note_invalid_filter_attempt,
    clear_invalid_filter_attempt,
)
from .color_utils import COLOR_KEYWORDS, color_matches
from ..services.chat_service import create_artifact
from ..services.fashion_vision_service import analyze_fashion_images, FashionVisionError
from .query_context import get_query_context, average_embeddings, get_session_image_blocks
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
    if inferred_category:
        payload["resolved_category_hint"] = inferred_category
        payload["suggested_next_call"] = (
            f'add_filter("{dimension}", "{value}", category="{inferred_category}")'
        )
    return json.dumps(payload, ensure_ascii=False)


def _session_id_from_config(config: RunnableConfig | None) -> str | None:
    if not config:
        return None
    thread_id = get_thread_id(config)
    if ":" not in thread_id:
        return None
    return thread_id.split(":", 1)[1]


def _normalize_vector(vector: list[float]) -> list[float]:
    norm = sum(value * value for value in vector) ** 0.5
    if norm < 1e-9:
        return vector
    return [value / norm for value in vector]


def _fuse_query_vectors(
    *,
    text_vector: list[float] | None,
    image_vector: list[float] | None,
) -> list[float] | None:
    if text_vector is None and image_vector is None:
        return None
    if text_vector is None:
        return _normalize_vector(image_vector or [])
    if image_vector is None:
        return _normalize_vector(text_vector)

    # Image dominates retrieval intent; text acts as a precision hint.
    weight_image = 0.7
    weight_text = 0.3
    fused = [
        weight_image * image_value + weight_text * text_value
        for image_value, text_value in zip(image_vector, text_vector)
    ]
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

    text_vector = encode_text(query) if query else None
    fused_vector = _fuse_query_vectors(text_vector=text_vector, image_vector=image_vector)
    if fused_vector is not None:
        fused_vector = apply_aesthetic_boost(fused_vector)

    session = {
        "query": query,
        "vector_type": "fashion_clip",
        "q_emb": fused_vector,
        "filters": [],
        "active": True,
    }

    set_session(config, session)
    count = count_session(client, session)
    return json.dumps({
        "status": "collection_started",
        "total": count,
        "query": query or "(all images)",
        "message": (
            f"Collection started with {count} images. Use add_filter to narrow down."
            if not image_vectors
            else f"Collection started with {count} images using {len(image_vectors)} uploaded image(s). Use add_filter to narrow down."
        ),
    })


# ═══════════════════════════════════════════════════════════════
#  Tool: add_filter
# ═══════════════════════════════════════════════════════════════

@tool
def add_filter(
    dimension: str,
    value: str,
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

    GARMENT_TAG_DIMS = {"color", "fabric", "pattern", "silhouette"}
    GARMENT_NESTED_DIMS = {"sleeve_length", "sleeve", "garment_length", "length", "collar"}
    meta_dims = {"brand", "gender", "season", "year_min", "image_type"}

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
                )
            return _structured_filter_error(
                dimension=dimension,
                value=value,
                reason=(
                    f"For '{dimension}' filter, specify which garment category. "
                    f'Example: add_filter("{dimension}", "{value}", category="dress")'
                ),
                inferred_category=inferred_category,
            )
        return json.dumps({"error": f"Unknown dimension: {dimension}"})

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
    results = apply_session_filters(client, session)

    peek_results = []
    for p in results[:limit]:
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
        "total": len(results),
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
    results = apply_session_filters(client, session)
    count = len(results)

    filter_summary = []
    for f in session["filters"]:
        if f["type"] == "category":
            filter_summary.append(f"category={f['value']}")
        elif f["type"] == "garment_tag":
            filter_summary.append(f"{f['key']}={f['value'].split(':')[1]}")
        else:
            filter_summary.append(f"{f['key']}={f['value']}")

    q_emb_raw = session.get("q_emb")
    q_emb_list = (
        q_emb_raw.tolist() if hasattr(q_emb_raw, "tolist")
        else list(q_emb_raw) if q_emb_raw is not None
        else None
    )

    serializable_session = {
        "query": session.get("query", ""),
        "vector_type": session.get("vector_type", "tag"),
        "q_emb": q_emb_list,
        "filters": session.get("filters", []),
        "active": session.get("active", True),
    }

    sample_images = []
    for point in results[:8]:
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
        "message": f"Sent query to UI to display {count} images. Filters applied: {len(filter_summary)}.",
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
    dimension: str,
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
    fashion_vision,
    start_collection, add_filter, remove_filter, peek_collection, show_collection,
    explore_colors, analyze_trends, get_image_details,
]
