"""
Fashion Search Agent Tools — Qdrant-based search tools for LangGraph.

Migrated from temp/agent/tools.py (v5 Database-First Architecture).
Key changes from MVP:
  - Qdrant connection from settings (not hardcoded localhost)
  - Session state passed via LangGraph State (not global _session)
  - color_utils inlined from agent.color_utils
  - Embedding stub (raises clear error if pipeline not available)

Tools:
  1. start_collection — Begin filtering session
  2. add_filter — Progressive filter narrowing
  3. remove_filter — Undo a filter
  4. peek_collection — Self-check (no display)
  5. show_collection — Final result display
  6. explore_colors — Color palette exploration
  7. analyze_trends — Aggregated statistics
  8. get_image_details — Single image detail lookup
"""

import json
from typing import Annotated, Optional
from langchain_core.tools import tool, InjectedToolArg
from langchain_core.runnables import RunnableConfig
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny, Range

from .color_utils import (
    COLOR_KEYWORDS,
    hex_to_lab,
    color_distance,
    color_matches,
)

# ═══════════════════════════════════════════════════════════════
#  Shared Infrastructure
# ═══════════════════════════════════════════════════════════════

_qdrant: QdrantClient | None = None


def get_qdrant() -> QdrantClient:
    """Get or create Qdrant client from settings."""
    global _qdrant
    if _qdrant is None:
        from ..config import settings
        _qdrant = QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY,
        )
    return _qdrant


def _get_collection() -> str:
    """Get the Qdrant collection name from settings."""
    from ..config import settings
    return settings.QDRANT_COLLECTION


import httpx

_embedding_client: httpx.Client | None = None


def _get_embedding_client() -> httpx.Client:
    """Get or create a reusable HTTP client for embedding requests."""
    global _embedding_client
    if _embedding_client is None:
        _embedding_client = httpx.Client(timeout=30.0)
    return _embedding_client


def _encode_text(text: str) -> list[float]:
    """Encode text to embedding vector via OpenAI-compatible endpoint.

    Uses Marqo/marqo-fashionSigLIP model (768-dim) at the configured
    embedding URL. Supports both text and image inputs.
    """
    from ..config import settings
    client = _get_embedding_client()
    resp = client.post(
        f"{settings.EMBEDDING_URL}/v1/embeddings",
        json={"model": settings.EMBEDDING_MODEL, "input": text},
    )
    resp.raise_for_status()
    data = resp.json()
    return data["data"][0]["embedding"]


# ── Negative prompt aesthetic boost ──
_NEGATIVE_PROMPT = ("low quality, amateur photography, poor lighting, "
                    "unflattering angle, blurry, bad composition, portrait, fat")
_AESTHETIC_ALPHA = 1.0
_neg_embedding: list[float] | None = None


def _get_negative_embedding() -> list[float]:
    """Get (and cache) the negative prompt embedding for aesthetic boost."""
    global _neg_embedding
    if _neg_embedding is None:
        _neg_embedding = _encode_text(_NEGATIVE_PROMPT)
    return _neg_embedding


def _apply_aesthetic_boost(v_pos: list[float]) -> list[float]:
    """Apply negative prompt vector arithmetic: normalize(v_pos - α * v_neg).

    Pushes query embedding away from low-quality image characteristics,
    resulting in higher-aesthetic results ranking first.
    """
    import math
    v_neg = _get_negative_embedding()
    result = [p - _AESTHETIC_ALPHA * n for p, n in zip(v_pos, v_neg)]
    norm = math.sqrt(sum(x * x for x in result))
    if norm < 1e-9:
        return result
    return [x / norm for x in result]


def _build_qdrant_filter(
    categories=None, brand=None, gender=None, top_categories=None,
    season=None, year_min=None, image_type=None,
    garment_tags=None,
) -> Filter | None:
    """Build Qdrant filter using ALL available database indexes."""
    conditions = []
    if brand:
        conditions.append(FieldCondition(key="brand", match=MatchValue(value=brand.lower())))
    if gender:
        conditions.append(FieldCondition(key="gender", match=MatchValue(value=gender.lower())))
    if image_type:
        conditions.append(FieldCondition(key="image_type", match=MatchValue(value=image_type)))
    if categories and not garment_tags:
        conditions.append(FieldCondition(
            key="categories", match=MatchAny(any=[c.lower() for c in categories])
        ))
    if top_categories:
        conditions.append(FieldCondition(
            key="top_categories", match=MatchAny(any=[tc.lower() for tc in top_categories])
        ))
    if season:
        conditions.append(FieldCondition(
            key="season", match=MatchAny(any=[s.lower() for s in season])
        ))
    if year_min:
        conditions.append(FieldCondition(key="year", range=Range(gte=year_min)))
    if garment_tags:
        conditions.append(FieldCondition(
            key="garment_tags", match=MatchAny(any=[t.lower() for t in garment_tags])
        ))
    return Filter(must=conditions) if conditions else None


def _select_vector_type(query: str, style_keywords: list | None,
                        has_garment_attrs: bool) -> str:
    """Select best vector type based on query nature."""
    has_style = style_keywords and len(style_keywords) > 0
    if has_style and not has_garment_attrs:
        return "fashion_clip"
    return "tag"


def _format_result(payload: dict, score: float = 0) -> dict:
    garments_summary = []
    for g in payload.get("garments", []):
        garments_summary.append({
            "name": g.get("name", ""),
            "category": g.get("category", ""),
            "pattern": g.get("pattern", ""),
            "fabric": g.get("fabric", ""),
            "silhouette": g.get("silhouette", ""),
            "sleeve_length": g.get("sleeve", ""),
            "garment_length": g.get("length", ""),
            "collar": g.get("collar", ""),
            "colors": [c.get("name", "") for c in g.get("colors", [])],
        })

    # Convert Qdrant person_bbox [x1,y1,x2,y2] (0-1) to aimoda-web bbox_range_percent format
    bbox = payload.get("person_bbox")
    object_area = None
    if bbox and isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        try:
            x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
            if 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1:
                object_area = {
                    "bbox_range_percent": {
                        "startX_percent": x1 * 100,
                        "startY_percent": y1 * 100,
                        "endX_percent": x2 * 100,
                        "endY_percent": y2 * 100,
                    },
                    "image_width": 1000,
                    "image_height": 1500,
                }
        except (ValueError, TypeError):
            pass

    return {
        "image_url": payload.get("image_url", ""),
        "image_id": payload.get("image_id", ""),
        "score": round(score, 4) if score else 0,
        "brand": payload.get("brand", ""),
        "style": payload.get("style", ""),
        "gender": payload.get("gender", ""),
        "season": payload.get("season", ""),
        "year": payload.get("year", 0),
        "garments": garments_summary,
        "colors": [c.get("color_name", "") for c in payload.get("extracted_colors", [])],
        "object_area": object_area,
    }


def _build_guidance(client, base_filter_conditions: list, user_color: str | None,
                    user_categories: list | None) -> dict:
    """When 0 results, analyze what IS available and return structured guidance."""
    collection = _get_collection()
    guidance = {"reason": "No matching items found in database."}

    if user_categories:
        cat_filter = Filter(must=[
            FieldCondition(key="categories", match=MatchAny(any=[c.lower() for c in user_categories]))
        ])
        pts = _scroll_all(client, collection, scroll_filter=cat_filter)
        color_counter = {}
        for p in pts:
            for fam in p.payload.get("color_families", []):
                color_counter[fam] = color_counter.get(fam, 0) + 1
        available = sorted(color_counter.items(), key=lambda x: -x[1])[:10]
        guidance["available_colors_for_category"] = [
            {"color": c, "count": n} for c, n in available
        ]

    if user_color:
        color_filter = Filter(must=[
            FieldCondition(key="color_families", match=MatchAny(any=[user_color.lower()]))
        ])
        pts = _scroll_all(client, collection, scroll_filter=color_filter)
        cat_counter = {}
        for p in pts:
            for cat in p.payload.get("categories", []):
                cat_counter[cat] = cat_counter.get(cat, 0) + 1
        available = sorted(cat_counter.items(), key=lambda x: -x[1])[:10]
        guidance["available_categories_for_color"] = [
            {"category": c, "count": n} for c, n in available
        ]

    return guidance


# ═══════════════════════════════════════════════════════════════
#  Collection Filtering — Progressive "filter panel" paradigm
#  Session state is keyed by LangGraph thread_id so concurrent
#  users never collide.  Tools receive the thread_id via
#  RunnableConfig (injected automatically by LangGraph).
# ═══════════════════════════════════════════════════════════════

_sessions: dict[str, dict] = {}   # thread_id → session state

_EMPTY_SESSION: dict = {
    "query": "",
    "vector_type": "tag",
    "q_emb": None,
    "filters": [],
    "active": False,
}

MAX_SCROLL = 2000   # safety cap for paginated scroll
SCROLL_PAGE = 500   # points per scroll page


def _get_thread_id(config: RunnableConfig) -> str:
    """Extract thread_id from LangGraph RunnableConfig."""
    return config.get("configurable", {}).get("thread_id", "__default__")


def _get_session(config: RunnableConfig) -> dict:
    """Get the session dict for the current thread."""
    tid = _get_thread_id(config)
    return _sessions.get(tid, dict(_EMPTY_SESSION))


def _set_session(config: RunnableConfig, session: dict) -> None:
    """Store the session dict for the current thread."""
    tid = _get_thread_id(config)
    _sessions[tid] = session


def _scroll_all(client, collection: str, scroll_filter=None,
                max_results: int = MAX_SCROLL) -> list:
    """Paginated scroll that fetches up to *max_results* points.

    Uses Qdrant's offset-based pagination (next page offset returned
    from each scroll call) so we are not limited to a single page.
    """
    all_pts: list = []
    next_offset = None
    while len(all_pts) < max_results:
        batch_size = min(SCROLL_PAGE, max_results - len(all_pts))
        pts, next_offset = client.scroll(
            collection,
            scroll_filter=scroll_filter,
            limit=batch_size,
            offset=next_offset,
            with_payload=True,
            with_vectors=False,
        )
        all_pts.extend(pts)
        if next_offset is None or len(pts) < batch_size:
            break  # no more pages
    return all_pts


def _build_session_filter(session):
    """Build Qdrant filter from session filters. Returns (filter, category_values)."""
    must_conditions = []
    must_not_conditions = []

    OUTER_LAYERS = {"jacket", "coat", "trench coat", "blazer", "cardigan",
                    "vest", "poncho", "cape", "parka", "windbreaker"}
    INNER_LAYERS = {"dress", "shirt", "t-shirt", "sweater", "blouse", "top",
                    "turtleneck sweater", "polo shirt", "tank top", "camisole",
                    "hoodie", "crop top"}

    category_values = set()

    for f in session["filters"]:
        if f["type"] == "category":
            category_values.add(f["value"].lower())
            must_conditions.append(
                FieldCondition(key="categories", match=MatchAny(any=[f["value"].lower()]))
            )
        elif f["type"] == "garment_tag":
            must_conditions.append(
                FieldCondition(key="garment_tags", match=MatchAny(any=[f["value"].lower()]))
            )
        elif f["type"] == "garment_attr":
            must_conditions.append(
                FieldCondition(key=f"garments[].{f['field']}",
                               match=MatchValue(value=f["value"].lower()))
            )
        elif f["type"] == "meta":
            key = f["key"]
            val = f["value"]
            if key == "season":
                must_conditions.append(FieldCondition(key="season", match=MatchAny(any=[val.lower()])))
            elif key == "year_min":
                must_conditions.append(FieldCondition(key="year", range=Range(gte=int(val))))
            else:
                must_conditions.append(FieldCondition(key=key, match=MatchValue(value=val.lower())))

    has_inner = category_values & INNER_LAYERS
    has_outer = category_values & OUTER_LAYERS
    if has_inner and not has_outer:
        for outer in OUTER_LAYERS:
            must_not_conditions.append(
                FieldCondition(key="categories", match=MatchAny(any=[outer]))
            )

    qdrant_filter = Filter(
        must=must_conditions if must_conditions else None,
        must_not=must_not_conditions if must_not_conditions else None,
    ) if must_conditions or must_not_conditions else None

    return qdrant_filter


def _count_session(client, session) -> int:
    """Count matching images using Qdrant count() — fast, no payload transfer."""
    collection = _get_collection()
    qdrant_filter = _build_session_filter(session)
    result = client.count(collection_name=collection, count_filter=qdrant_filter, exact=True)
    return result.count


def _apply_session_filters(client, session):
    """Apply all current filters and return actual results. Use only when data is needed."""
    collection = _get_collection()
    qdrant_filter = _build_session_filter(session)

    if session["q_emb"] is not None:
        results = client.query_points(
            collection_name=collection,
            query=session["q_emb"],
            using=session["vector_type"],
            query_filter=qdrant_filter,
            limit=200,     # Only used by peek_collection, no need for full dataset
            with_payload=True,
        )
        return [p for p in results.points]
    else:
        return _scroll_all(client, collection, scroll_filter=qdrant_filter)


def _available_values(client, dimension, category=None, current_filters=None):
    """Find what values are available for a dimension given current filters."""
    collection = _get_collection()
    must_conditions = []
    if current_filters:
        for f in current_filters:
            if f["type"] == "category":
                must_conditions.append(
                    FieldCondition(key="categories", match=MatchAny(any=[f["value"].lower()]))
                )
            elif f["type"] == "garment_tag":
                must_conditions.append(
                    FieldCondition(key="garment_tags", match=MatchAny(any=[f["value"].lower()]))
                )
            elif f["type"] == "garment_attr":
                must_conditions.append(
                    FieldCondition(key=f"garments[].{f['field']}",
                                   match=MatchValue(value=f["value"].lower()))
                )
            elif f["type"] == "meta":
                key = f["key"]
                val = f["value"]
                if key == "season":
                    must_conditions.append(FieldCondition(key="season", match=MatchAny(any=[val.lower()])))
                elif key == "year_min":
                    must_conditions.append(FieldCondition(key="year", range=Range(gte=int(val))))
                else:
                    must_conditions.append(FieldCondition(key=key, match=MatchValue(value=val.lower())))

    scroll_filter = Filter(must=must_conditions) if must_conditions else None
    pts = _scroll_all(client, collection, scroll_filter=scroll_filter)

    from collections import Counter
    counter = Counter()

    # Dimensions indexed in garment_tags: category:color, category:fabric, category:pattern, category:silhouette
    GARMENT_TAG_DIMS = {"color", "fabric", "pattern", "silhouette"}
    # Dimensions only in garments[] nested objects (not in garment_tags)
    GARMENT_NESTED_DIMS = {"sleeve_length", "garment_length", "collar"}
    # Map user-facing dimension names to actual Qdrant field names
    DIM_TO_FIELD = {"sleeve_length": "sleeve", "garment_length": "length", "collar": "collar"}

    if dimension in GARMENT_TAG_DIMS:
        # Use garment_tags (category:value format)
        prefix = f"{category}:" if category else ""
        for p in pts:
            for tag in p.payload.get("garment_tags", []):
                if prefix and tag.startswith(prefix):
                    counter[tag.split(":")[1]] += 1
    elif dimension in GARMENT_NESTED_DIMS:
        # Scan garments[] sub-objects with actual Qdrant field name
        field = DIM_TO_FIELD[dimension]
        for p in pts:
            for g in p.payload.get("garments", []):
                if category and g.get("category", "").lower() != category.lower():
                    continue
                v = g.get(field, "")
                if v:
                    counter[v] += 1
    elif dimension == "category":
        for p in pts:
            for cat in p.payload.get("categories", []):
                counter[cat] += 1
    else:
        # Image-level dimension
        for p in pts:
            v = p.payload.get(dimension, "")
            if v:
                counter[str(v)] += 1

    return [{"value": v, "count": c} for v, c in counter.most_common(10)]


# ── Tool definitions ──

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

    if query:
        q_emb = _encode_text(query)
        q_emb = _apply_aesthetic_boost(q_emb)
        session = {
            "query": query,
            "vector_type": "fashion_clip",
            "q_emb": q_emb,
            "filters": [],
            "active": True,
        }
    else:
        session = {
            "query": "",
            "vector_type": "fashion_clip",
            "q_emb": None,
            "filters": [],
            "active": True,
        }

    _set_session(config, session)
    count = _count_session(client, session)
    return json.dumps({
        "status": "collection_started",
        "total": count,
        "query": query or "(all images)",
        "message": f"Collection started with {count} images. Use add_filter to narrow down.",
    })


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
      you MUST pass the `category` argument.
    - If dimension is an image attribute (brand, gender, season, year_min, image_type), DO NOT pass `category`.

    Returns: remaining count. If 0, suggests available values — DO NOT add this filter.
    """
    session = _get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()

    # garment_tags indexes: category:color, category:fabric, category:pattern, category:silhouette
    GARMENT_TAG_DIMS = {"color", "fabric", "pattern", "silhouette"}
    # Only sleeve/length/collar need nested garments[].field queries
    GARMENT_NESTED_DIMS = {"sleeve_length", "sleeve", "garment_length", "length", "collar"}
    meta_dims = {"brand", "gender", "season", "year_min", "image_type"}

    # Map user-facing dimension names to actual Qdrant field names
    DIM_TO_FIELD = {"sleeve_length": "sleeve", "sleeve": "sleeve",
                    "garment_length": "length", "length": "length",
                    "collar": "collar"}

    # Normalize dimension aliases for display key
    dim_normalized = dimension
    if dimension == "sleeve":
        dim_normalized = "sleeve_length"
    elif dimension == "length":
        dim_normalized = "garment_length"

    if dimension == "category":
        entry = {"type": "category", "key": "category", "value": value}
    elif dimension in GARMENT_TAG_DIMS and category:
        # Color, fabric, pattern, silhouette — all indexed in garment_tags as category:value
        tag_value = f"{category.lower()}:{value.lower()}"
        entry = {"type": "garment_tag", "key": f"{category}:{dimension}", "value": tag_value}
    elif dimension in GARMENT_NESTED_DIMS and category:
        # sleeve, length, collar — use Qdrant nested garments[].field syntax
        field = DIM_TO_FIELD[dimension]
        entry = {"type": "garment_attr", "key": f"{category}:{dim_normalized}",
                 "field": field, "value": value}
    elif dimension in meta_dims:
        entry = {"type": "meta", "key": dimension, "value": value}
    else:
        if dimension in (GARMENT_TAG_DIMS | GARMENT_NESTED_DIMS):
            return json.dumps({
                "error": f"For '{dimension}' filter, specify which garment category. "
                         f'Example: add_filter("{dimension}", "{value}", category="dress")',
            })
        return json.dumps({"error": f"Unknown dimension: {dimension}"})

    test_filters = session["filters"] + [entry]
    test_session = dict(session)
    test_session["filters"] = test_filters
    count = _count_session(client, test_session)

    if count > 0:
        session["filters"].append(entry)
        _set_session(config, session)
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
        })
    else:
        available = _available_values(client, dimension, category, session["filters"])
        return json.dumps({
            "action": "filter_rejected",
            "filter": f"{dimension}={value}" + (f" (on {category})" if category else ""),
            "remaining": 0,
            "message": f"Adding {dimension}={value} would result in 0 images. Filter NOT added.",
            "available_values": available,
            "suggestion": "Try one of the available values instead, or skip this dimension.",
        })


@tool
def remove_filter(
    dimension: str,
    category: Optional[str] = None,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Remove a previously added filter. Undoes the narrowing for that dimension."""
    session = _get_session(config)
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
    _set_session(config, session)
    count = _count_session(client, session)

    return json.dumps({
        "action": "filter_removed",
        "removed": [f"{f.get('key', '')}={f.get('value', '')}" for f in removed],
        "remaining": count,
        "message": f"Removed {len(removed)} filter(s). {count} images remaining.",
    })


@tool
def peek_collection(
    limit: int = 15,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Secretly preview the current filtered collection to self-check.
    This does NOT display images to the user. Only returns text metadata for you to review.
    """
    session = _get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()
    results = _apply_session_filters(client, session)

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


@tool
def show_collection(
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Get the final collection and send it to the frontend for display.
    Call this ONLY when you are completely finished filtering.
    """
    session = _get_session(config)
    if not session.get("active"):
        return json.dumps({"error": "No active collection. Call start_collection first."})

    client = get_qdrant()
    count = _count_session(client, session)

    filter_summary = []
    for f in session["filters"]:
        if f["type"] == "category":
            filter_summary.append(f"category={f['value']}")
        elif f["type"] == "garment_tag":
            filter_summary.append(f"{f['key']}={f['value'].split(':')[1]}")
        else:
            filter_summary.append(f"{f['key']}={f['value']}")

    q_emb_raw = session.get("q_emb")
    if q_emb_raw is not None:
        q_emb_list = q_emb_raw.tolist() if hasattr(q_emb_raw, 'tolist') else list(q_emb_raw)
    else:
        q_emb_list = None

    serializable_session = {
        "query": session.get("query", ""),
        "vector_type": session.get("vector_type", "tag"),
        "q_emb": q_emb_list,
        "filters": session.get("filters", []),
        "active": session.get("active", True),
    }

    return json.dumps({
        "action": "show_collection",
        "search_request": serializable_session,
        "total": count,
        "filters_applied": filter_summary,
        "message": f"Sent query to UI to display {count} images. Filters applied: {len(filter_summary)}.",
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: explore_colors — Color palette exploration
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
    collection = _get_collection()
    client = get_qdrant()
    qdrant_filter = _build_qdrant_filter(categories=categories, brand=brand)
    pts = _scroll_all(client, collection, scroll_filter=qdrant_filter)

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
#  Tool: analyze_trends — Aggregated statistics
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
    top_n: int = 15,
) -> str:
    """Analyze TRENDS and statistics. Counts and ranks — does NOT search images.

    Args:
        dimension: Which attribute to analyze. Supported values:
            Garment-level: "color", "fabric", "pattern", "silhouette",
                          "sleeve_length", "garment_length", "collar"
            Image-level:   "brand", "style", "category", "season", "year", "gender"
        categories, fabric, color, pattern, silhouette, brand, season, year_min: Optional filters
        top_n: default 15
    """
    collection = _get_collection()
    client = get_qdrant()

    qdrant_filter = _build_qdrant_filter(categories=categories, brand=brand, season=season, year_min=year_min)

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

    pts = _scroll_all(client, collection, scroll_filter=qdrant_filter)

    # ── Image-level dimensions ──
    IMAGE_DIMS = {"brand", "style", "gender"}
    GARMENT_SIMPLE_DIMS = {"fabric", "pattern", "silhouette", "collar"}
    # Map user-facing names to actual Qdrant field names for nested fields
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

    ranked = sorted(counter.items(), key=lambda x: -x[1])[:top_n]
    total = max(sum(counter.values()), 1)
    return json.dumps({
        "dimension": dimension,
        "total_items_analyzed": len(pts),
        "ranking": [{"name": n, "count": c, "percentage": f"{c/total*100:.1f}%"} for n, c in ranked],
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
#  Tool: get_image_details
# ═══════════════════════════════════════════════════════════════

@tool
def get_image_details(image_id: str) -> str:
    """Get full details of a specific image by its ID."""
    collection = _get_collection()
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
    start_collection, add_filter, remove_filter, peek_collection, show_collection,
    explore_colors, analyze_trends, get_image_details,
]
