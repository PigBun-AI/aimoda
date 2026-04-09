from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from ..agent.qdrant_utils import apply_aesthetic_boost, encode_text, get_qdrant
from ..agent.session_state import count_session
from ..services.chat_service import create_artifact, get_session
from ..value_normalization import normalize_quarter_value


def _format_filter_entry(filter_item: dict[str, Any]) -> str:
    filter_type = str(filter_item.get("type", "")).strip().lower()
    if filter_type == "category":
        return f"category={str(filter_item.get('value', '')).strip()}"
    if filter_type == "meta":
        key = str(filter_item.get("key", "")).strip()
        value = str(filter_item.get("value", "")).strip()
        return f"{key}={value}" if key else value
    return str(filter_item)


def _normalize_categories(values: Any) -> list[str]:
    if isinstance(values, list):
        raw_items = values
    elif values in (None, ""):
        raw_items = []
    else:
        raw_items = [values]
    categories: list[str] = []
    for item in raw_items:
        normalized = str(item or "").strip().lower()
        if normalized:
            categories.append(normalized)
    return categories


def build_search_session_from_plan(plan: dict[str, Any]) -> dict[str, Any]:
    query = str(plan.get("query", "") or "").strip()
    query_vector = encode_text(query) if query else None
    if query_vector is not None:
        query_vector = apply_aesthetic_boost(query_vector)

    filters: list[dict[str, Any]] = []
    for category in _normalize_categories(plan.get("categories")):
        filters.append({
            "type": "category",
            "key": "category",
            "value": category,
        })

    brand = str(plan.get("brand", "") or "").strip()
    if brand:
        filters.append({
            "type": "meta",
            "key": "brand",
            "value": brand,
        })

    gender = str(plan.get("gender", "") or "").strip().lower()
    if gender:
        filters.append({
            "type": "meta",
            "key": "gender",
            "value": gender,
        })

    quarter = normalize_quarter_value(plan.get("quarter"))
    if quarter:
        filters.append({
            "type": "meta",
            "key": "quarter",
            "value": quarter,
        })

    year_min = plan.get("year_min")
    if year_min not in (None, ""):
        try:
            year_value = int(year_min)
        except (TypeError, ValueError):
            year_value = None
        if year_value is not None:
            filters.append({
                "type": "meta",
                "key": "year_min",
                "value": str(year_value),
            })

    image_type = str(plan.get("image_type", "") or "").strip()
    if image_type:
        filters.append({
            "type": "meta",
            "key": "image_type",
            "value": image_type,
        })

    return {
        "query": query,
        "vector_type": "fashion_clip",
        "q_emb": query_vector,
        "filters": filters,
        "active": True,
    }


def materialize_search_plan_ref(
    *,
    user_id: int,
    session_id: str,
    current_session_id: str | None = None,
    plan: dict[str, Any],
) -> dict[str, Any]:
    artifact_session_id: str | None = None

    if current_session_id:
        current_session = get_session(current_session_id)
        if not current_session or int(current_session.get("user_id", 0) or 0) != int(user_id):
            raise ValueError("Search plan context session not found")
        artifact_session_id = str(current_session.get("id") or current_session_id)
    else:
        source_session = get_session(session_id)
        if source_session and int(source_session.get("user_id", 0) or 0) == int(user_id):
            artifact_session_id = str(source_session.get("id") or session_id)

    if not artifact_session_id:
        raise ValueError("Search plan context session not found")

    search_session = build_search_session_from_plan(plan)
    client = get_qdrant()
    total = count_session(client, search_session)
    filter_summary = [
        _format_filter_entry(item)
        for item in search_session.get("filters", [])
        if isinstance(item, dict)
    ]

    artifact = create_artifact(
        session_id=artifact_session_id,
        artifact_type="collection_result",
        storage_type="database",
        metadata={
            "search_session": search_session,
            "total": total,
            "filters_applied": filter_summary,
            "group_label": str(plan.get("label", "") or "").strip(),
            "ref_source": str(plan.get("source", "") or "search_plan_ref"),
            "ref_source_session_id": str(session_id),
            "artifact_session_id": artifact_session_id,
            "ref_resolution_mode": "portable_search_plan",
        },
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )

    return {
        "search_request_id": str(artifact["id"]),
        "total": total,
        "label": str(plan.get("label", "") or "").strip(),
        "filters_applied": filter_summary,
    }
