"""
Session state management for the Fashion Search Agent.

Extracted from tools.py. Each LangGraph thread gets its own
isolated session state keyed by thread_id.
"""

from collections import Counter
from langchain_core.runnables import RunnableConfig
from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny, Range

from .qdrant_utils import get_collection, scroll_all

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


def count_session(client, session) -> int:
    """Count matching images using Qdrant count() — fast, no payload transfer."""
    collection = get_collection()
    qdrant_filter = build_session_filter(session)
    result = client.count(collection_name=collection, count_filter=qdrant_filter, exact=True)
    return result.count


def apply_session_filters(client, session):
    """Apply all current filters and return actual results."""
    collection = get_collection()
    qdrant_filter = build_session_filter(session)

    if session["q_emb"] is not None:
        results = client.query_points(
            collection_name=collection,
            query=session["q_emb"],
            using=session["vector_type"],
            query_filter=qdrant_filter,
            limit=200,
            with_payload=True,
        )
        return [p for p in results.points]
    else:
        return scroll_all(client, collection, scroll_filter=qdrant_filter)


def available_values(client, dimension, category=None, current_filters=None):
    """Find what values are available for a dimension given current filters."""
    collection = get_collection()
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
    pts = scroll_all(client, collection, scroll_filter=scroll_filter)

    counter = Counter()

    GARMENT_TAG_DIMS = {"color", "fabric", "pattern", "silhouette"}
    GARMENT_NESTED_DIMS = {"sleeve_length", "garment_length", "collar"}
    DIM_TO_FIELD = {"sleeve_length": "sleeve", "garment_length": "length", "collar": "collar"}

    if dimension in GARMENT_TAG_DIMS:
        prefix = f"{category}:" if category else ""
        for p in pts:
            for tag in p.payload.get("garment_tags", []):
                if prefix and tag.startswith(prefix):
                    counter[tag.split(":")[1]] += 1
    elif dimension in GARMENT_NESTED_DIMS:
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
        for p in pts:
            v = p.payload.get(dimension, "")
            if v:
                counter[str(v)] += 1

    return [{"value": v, "count": c} for v, c in counter.most_common(10)]
