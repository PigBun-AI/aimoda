"""
Session state management for the Fashion Search Agent.

Extracted from tools.py. Each LangGraph thread gets its own
isolated session state keyed by thread_id.
"""

import json
import time
from collections import Counter
from typing import Any, Callable
from langchain_core.runnables import RunnableConfig
from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny, Range

from .qdrant_utils import get_collection, iter_scroll, scroll_all
from ..value_normalization import normalize_quarter_value

# ═══════════════════════════════════════════════════════════════
#  Session State Storage
# ═══════════════════════════════════════════════════════════════

_sessions: dict[str, dict] = {}   # thread_id → session state

_EMPTY_SESSION: dict = {
    "query": "",
    "vector_type": "tag",
    "q_emb": None,
    "filters": [],
    "active": False,
}
CancelCheck = Callable[[], None] | None


def _call_cancel_check(cancel_check: CancelCheck) -> None:
    if cancel_check:
        cancel_check()


def get_thread_id(config: RunnableConfig) -> str:
    """Extract thread_id from LangGraph RunnableConfig."""
    return config.get("configurable", {}).get("thread_id", "__default__")


def get_session(config: RunnableConfig) -> dict:
    """Get the session dict for the current thread."""
    tid = get_thread_id(config)
    return _sessions.get(tid, dict(_EMPTY_SESSION))


def set_session(config: RunnableConfig, session: dict) -> None:
    """Store the session dict for the current thread."""
    tid = get_thread_id(config)
    _sessions[tid] = session


# ═══════════════════════════════════════════════════════════════
#  Session Filter Building
# ═══════════════════════════════════════════════════════════════

OUTER_LAYERS = {"jacket", "coat", "trench coat", "blazer", "cardigan",
                "vest", "poncho", "cape", "parka", "windbreaker"}
INNER_LAYERS = {"dress", "shirt", "t-shirt", "sweater", "blouse", "top",
                "turtleneck sweater", "polo shirt", "tank top", "camisole",
                "hoodie", "crop top"}
GARMENT_TAG_DIMS = {"color", "fabric", "pattern", "silhouette"}
GARMENT_NESTED_DIMS = {"sleeve_length", "garment_length", "collar"}
DIM_TO_FIELD = {"sleeve_length": "sleeve", "garment_length": "length", "collar": "collar"}
FACET_FIELD_BY_DIMENSION = {
    "brand": "brand",
    "gender": "gender",
    "style": "style",
    "quarter": "quarter",
    "category": "categories",
}
AVAILABLE_VALUES_LIMIT = 10
AVAILABLE_VALUES_FACET_LIMIT = 128
AVAILABLE_VALUES_CACHE_TTL_SECONDS = 45.0
AVAILABLE_VALUES_SCAN_CAP = 4_000
_available_values_cache: dict[tuple[str, str | None, str], tuple[float, list[dict[str, Any]]]] = {}


def build_session_filter(session):
    """Build Qdrant filter from session filters. Returns a Filter or None."""
    must_conditions = []
    must_not_conditions = []

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
            if key == "quarter":
                quarter = normalize_quarter_value(val)
                if quarter:
                    must_conditions.append(FieldCondition(key="quarter", match=MatchAny(any=[quarter])))
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


def _build_filter_from_current_filters(current_filters: list[dict[str, Any]] | None) -> Filter | None:
    return build_session_filter({
        "query": "",
        "vector_type": "tag",
        "q_emb": None,
        "filters": current_filters or [],
        "active": True,
    })


def _infer_effective_category(
    category: str | None,
    current_filters: list[dict[str, Any]] | None,
) -> str | None:
    if category:
        return category.lower()
    category_filters = {
        str(filter_entry.get("value", "")).strip().lower()
        for filter_entry in (current_filters or [])
        if filter_entry.get("type") == "category" and filter_entry.get("value")
    }
    if len(category_filters) == 1:
        return next(iter(category_filters))
    return None


def _serialize_filters(current_filters: list[dict[str, Any]] | None) -> str:
    normalized_entries: list[dict[str, Any]] = []
    for filter_entry in current_filters or []:
        normalized_entries.append(
            {key: filter_entry[key] for key in sorted(filter_entry.keys())}
        )
    return json.dumps(normalized_entries, ensure_ascii=False, sort_keys=True)


def _cache_key_for_available_values(
    *,
    dimension: str,
    category: str | None,
    current_filters: list[dict[str, Any]] | None,
) -> tuple[str, str | None, str]:
    return (
        dimension,
        category,
        _serialize_filters(current_filters),
    )


def _get_cached_available_values(
    cache_key: tuple[str, str | None, str],
) -> list[dict[str, Any]] | None:
    cached = _available_values_cache.get(cache_key)
    if not cached:
        return None
    cached_at, payload = cached
    if time.monotonic() - cached_at > AVAILABLE_VALUES_CACHE_TTL_SECONDS:
        _available_values_cache.pop(cache_key, None)
        return None
    return payload


def _set_cached_available_values(
    cache_key: tuple[str, str | None, str],
    payload: list[dict[str, Any]],
) -> None:
    _available_values_cache[cache_key] = (time.monotonic(), payload)


def _counter_to_response(counter: Counter[str]) -> list[dict[str, Any]]:
    return [{"value": value, "count": count} for value, count in counter.most_common(AVAILABLE_VALUES_LIMIT)]


def _facet_values_for_field(
    client,
    *,
    field: str,
    qdrant_filter: Filter | None,
    limit: int = AVAILABLE_VALUES_FACET_LIMIT,
    cancel_check: CancelCheck = None,
):
    _call_cancel_check(cancel_check)
    response = client.facet(
        collection_name=get_collection(),
        key=field,
        facet_filter=qdrant_filter,
        limit=limit,
        exact=False,
    )
    _call_cancel_check(cancel_check)
    return response.hits


def _available_values_via_direct_facet(
    client,
    *,
    dimension: str,
    qdrant_filter: Filter | None,
    cancel_check: CancelCheck = None,
) -> list[dict[str, Any]]:
    field = FACET_FIELD_BY_DIMENSION.get(dimension)
    if not field:
        return []

    counter: Counter[str] = Counter()
    for hit in _facet_values_for_field(
        client,
        field=field,
        qdrant_filter=qdrant_filter,
        cancel_check=cancel_check,
    ):
        value = normalize_quarter_value(hit.value) if dimension == "quarter" else str(hit.value or "").strip()
        if value:
            counter[value] += int(hit.count or 0)

    return _counter_to_response(counter)


def _extract_garment_dimension_values(garment: dict[str, Any], dimension: str) -> list[str]:
    if dimension == "color":
        values: list[str] = []
        for color in garment.get("colors", []) or []:
            normalized = str(color.get("name", "")).strip().lower()
            if normalized:
                values.append(normalized)
        return values
    if dimension in {"fabric", "pattern", "silhouette"}:
        normalized = str(garment.get(dimension, "")).strip().lower()
        return [normalized] if normalized else []
    return []


def _available_values_via_garment_scan(
    client,
    *,
    dimension: str,
    category: str | None,
    qdrant_filter: Filter | None,
    cancel_check: CancelCheck = None,
) -> list[dict[str, Any]]:
    if not category:
        return []

    collection = get_collection()
    _call_cancel_check(cancel_check)
    total = client.count(collection_name=collection, count_filter=qdrant_filter, exact=False).count
    _call_cancel_check(cancel_check)
    max_results = min(max(total, 0), AVAILABLE_VALUES_SCAN_CAP)

    counter: Counter[str] = Counter()
    for point in iter_scroll(
        client,
        collection,
        scroll_filter=qdrant_filter,
        max_results=max_results,
        with_payload=True,
        cancel_check=cancel_check,
    ):
        for garment in point.payload.get("garments", []):
            if str(garment.get("category", "")).lower() != category:
                continue
            for value in _extract_garment_dimension_values(garment, dimension):
                counter[value] += 1
    return _counter_to_response(counter)


def _available_values_via_nested_scan(
    client,
    *,
    dimension: str,
    category: str | None,
    qdrant_filter: Filter | None,
    cancel_check: CancelCheck = None,
) -> list[dict[str, Any]]:
    field = DIM_TO_FIELD[dimension]
    collection = get_collection()
    _call_cancel_check(cancel_check)
    total = client.count(collection_name=collection, count_filter=qdrant_filter, exact=False).count
    _call_cancel_check(cancel_check)
    max_results = min(max(total, 0), AVAILABLE_VALUES_SCAN_CAP)

    counter: Counter[str] = Counter()
    for point in iter_scroll(
        client,
        collection,
        scroll_filter=qdrant_filter,
        max_results=max_results,
        with_payload=True,
        cancel_check=cancel_check,
    ):
        for garment in point.payload.get("garments", []):
            if category and str(garment.get("category", "")).lower() != category:
                continue
            value = str(garment.get(field, "")).strip().lower()
            if value:
                counter[value] += 1
    return _counter_to_response(counter)


def _available_values_via_payload_scan(
    client,
    *,
    dimension: str,
    qdrant_filter: Filter | None,
    cancel_check: CancelCheck = None,
) -> list[dict[str, Any]]:
    collection = get_collection()
    _call_cancel_check(cancel_check)
    total = client.count(collection_name=collection, count_filter=qdrant_filter, exact=False).count
    _call_cancel_check(cancel_check)
    max_results = min(max(total, 0), AVAILABLE_VALUES_SCAN_CAP)

    counter: Counter[str] = Counter()
    for point in iter_scroll(
        client,
        collection,
        scroll_filter=qdrant_filter,
        max_results=max_results,
        with_payload=True,
        cancel_check=cancel_check,
    ):
        value = point.payload.get(dimension)
        if not value:
            continue
        if isinstance(value, list):
            for item in value:
                normalized = str(item).strip()
                if normalized:
                    counter[normalized] += 1
        else:
            normalized = str(value).strip()
            if normalized:
                counter[normalized] += 1
    return _counter_to_response(counter)


def count_session(client, session, *, cancel_check: CancelCheck = None, exact: bool = True) -> int:
    """Count matching images using Qdrant count() — fast, no payload transfer."""
    collection = get_collection()
    qdrant_filter = build_session_filter(session)
    _call_cancel_check(cancel_check)
    result = client.count(collection_name=collection, count_filter=qdrant_filter, exact=exact)
    _call_cancel_check(cancel_check)
    return result.count


def get_session_page(client, session, *, offset: int = 0, limit: int = 20, cancel_check: CancelCheck = None):
    """Fetch one ranked page for the current session.

    For semantic sessions, we page directly in Qdrant vector search so the UI can
    keep loading beyond the initial preview window. For non-semantic sessions we
    fall back to scroll+slice because ordering is not similarity-sensitive.
    """
    collection = get_collection()
    qdrant_filter = build_session_filter(session)

    if session["q_emb"] is not None:
        _call_cancel_check(cancel_check)
        results = client.query_points(
            collection_name=collection,
            query=session["q_emb"],
            using=session["vector_type"],
            query_filter=qdrant_filter,
            limit=limit,
            offset=offset,
            with_payload=True,
        )
        _call_cancel_check(cancel_check)
        return [p for p in results.points]

    results = scroll_all(client, collection, scroll_filter=qdrant_filter, cancel_check=cancel_check)
    return results[offset: offset + limit]


def apply_session_filters(client, session, *, cancel_check: CancelCheck = None):
    """Apply all current filters and return actual results."""
    collection = get_collection()
    qdrant_filter = build_session_filter(session)

    if session["q_emb"] is not None:
        _call_cancel_check(cancel_check)
        results = client.query_points(
            collection_name=collection,
            query=session["q_emb"],
            using=session["vector_type"],
            query_filter=qdrant_filter,
            limit=200,
            with_payload=True,
        )
        _call_cancel_check(cancel_check)
        return [p for p in results.points]
    else:
        return scroll_all(client, collection, scroll_filter=qdrant_filter, cancel_check=cancel_check)


def available_values(client, dimension, category=None, current_filters=None, *, cancel_check: CancelCheck = None):
    """Find what values are available for a dimension given current filters."""
    effective_category = _infer_effective_category(category, current_filters)
    cache_key = _cache_key_for_available_values(
        dimension=dimension,
        category=effective_category,
        current_filters=current_filters,
    )
    cached = _get_cached_available_values(cache_key)
    if cached is not None:
        return cached

    qdrant_filter = _build_filter_from_current_filters(current_filters)

    if dimension in FACET_FIELD_BY_DIMENSION:
        result = _available_values_via_direct_facet(
            client,
            dimension=dimension,
            qdrant_filter=qdrant_filter,
            cancel_check=cancel_check,
        )
    elif dimension in GARMENT_TAG_DIMS:
        result = _available_values_via_garment_scan(
            client,
            dimension=dimension,
            category=effective_category,
            qdrant_filter=qdrant_filter,
            cancel_check=cancel_check,
        )
    elif dimension in GARMENT_NESTED_DIMS:
        result = _available_values_via_nested_scan(
            client,
            dimension=dimension,
            category=effective_category,
            qdrant_filter=qdrant_filter,
            cancel_check=cancel_check,
        )
    else:
        result = _available_values_via_payload_scan(
            client,
            dimension=dimension,
            qdrant_filter=qdrant_filter,
            cancel_check=cancel_check,
        )

    _set_cached_available_values(cache_key, result)
    return result
