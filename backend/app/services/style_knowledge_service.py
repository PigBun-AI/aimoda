from __future__ import annotations

from typing import Any

from qdrant_client.models import FieldCondition, Filter, MatchText, MatchValue

from ..agent.qdrant_utils import encode_text, get_qdrant
from ..config import settings


def _style_collection_name() -> str:
    return settings.STYLE_KNOWLEDGE_COLLECTION


def _normalize_query(query: str) -> str:
    return " ".join((query or "").strip().split())


def _scroll(filter_: Filter, limit: int) -> list[Any]:
    client = get_qdrant()
    result = client.scroll(
        _style_collection_name(),
        scroll_filter=filter_,
        limit=limit,
        with_payload=True,
    )
    if isinstance(result, tuple):
        return list(result[0])
    return list(getattr(result, "points", []))


def _unique_points(points: list[Any]) -> list[Any]:
    seen: set[str] = set()
    unique: list[Any] = []
    for point in points:
        payload = getattr(point, "payload", {}) or {}
        style_name = str(payload.get("style_name", "")).strip().lower()
        if not style_name or style_name in seen:
            continue
        seen.add(style_name)
        unique.append(point)
    return unique


def _compact_visual_description(description: str, *, max_words: int = 48) -> str:
    words = [word for word in description.replace("\n", " ").split(" ") if word]
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words])


def _style_features(style: dict[str, Any]) -> dict[str, Any]:
    visual_description = _compact_visual_description(str(style.get("visual_description", "")).strip())
    palette = [str(item).strip() for item in style.get("palette", []) if str(item).strip()]
    silhouettes = [str(item).strip() for item in style.get("silhouette", []) if str(item).strip()]
    fabrics = [str(item).strip() for item in style.get("fabric", []) if str(item).strip()]
    details = [str(item).strip() for item in style.get("details", []) if str(item).strip()]
    brands = [str(item).strip() for item in style.get("reference_brands", []) if str(item).strip()]
    seasons = [str(item).strip() for item in style.get("season_relevance", []) if str(item).strip()]
    gender = str(style.get("gender", "")).strip()

    return {
        "visual_description_en": visual_description,
        "palette": palette[:4],
        "silhouette": silhouettes[:3],
        "fabric": fabrics[:3],
        "details": details[:4],
        "reference_brands": brands[:4],
        "season_relevance": seasons[:3],
        "gender": gender,
    }


def build_style_retrieval_plan(style: dict[str, Any], *, user_query: str) -> dict[str, Any]:
    features = _style_features(style)

    semantic_parts: list[str] = []
    if features["visual_description_en"]:
        semantic_parts.append(features["visual_description_en"])
    if features["palette"]:
        semantic_parts.append(f"palette: {', '.join(features['palette'])}")
    if features["silhouette"]:
        semantic_parts.append(f"silhouette: {', '.join(features['silhouette'])}")
    if features["fabric"]:
        semantic_parts.append(f"fabric: {', '.join(features['fabric'])}")
    if features["details"]:
        semantic_parts.append(f"details: {', '.join(features['details'])}")

    suggested_filters: dict[str, Any] = {}
    if features["fabric"]:
        suggested_filters["fabric"] = features["fabric"]
    if features["silhouette"]:
        suggested_filters["silhouette"] = features["silhouette"]
    if features["season_relevance"]:
        suggested_filters["season"] = features["season_relevance"][:2]

    gender = str(features.get("gender", "")).strip().lower()
    if gender and gender not in {"all", "unisex"}:
        suggested_filters["gender"] = features["gender"]

    semantic_boost_terms = list(dict.fromkeys([
        *features["silhouette"],
        *features["fabric"],
        *features["details"][:3],
        *features["palette"][:3],
    ]))

    return {
        "retrieval_query_en": ", ".join(part for part in semantic_parts if part),
        "semantic_boost_terms": semantic_boost_terms,
        "suggested_filters": suggested_filters,
        "soft_constraints": {
            "palette": features["palette"],
            "details": features["details"],
            "reference_brands": features["reference_brands"],
        },
        "agent_guidance": {
            "recommended_next_step": "start_collection",
            "recommended_strategy": (
                "Use retrieval_query_en as the semantic retrieval base, then apply only high-confidence concrete "
                "filters such as fabric, silhouette, season, or gender if the user needs more precision. "
                "If no single garment category is resolved yet, keep palette/fabric cues inside retrieval_query_en "
                "instead of calling add_filter(...) immediately."
            ),
            "avoid_as_hard_filters": ["palette", "reference_brands", "style_name"],
            "category_required_filter_dimensions": ["color", "fabric", "pattern", "silhouette", "collar", "sleeve_length"],
            "query_context": user_query,
        },
    }


def _point_to_slim(point: Any, *, match_type: str, score: float | None = None) -> dict[str, Any]:
    payload = getattr(point, "payload", {}) or {}
    result = {
        "style_name": payload.get("style_name", ""),
        "aliases": payload.get("aliases", []),
        "category": payload.get("category", ""),
        "confidence": payload.get("confidence", 0),
        "match_type": match_type,
    }
    if score is not None:
        result["score"] = round(float(score), 4)
    return result


def _search_exact(query: str, limit: int) -> list[Any]:
    return _unique_points(_scroll(
        Filter(should=[
            FieldCondition(key="style_name", match=MatchValue(value=query)),
            FieldCondition(key="aliases", match=MatchValue(value=query)),
        ]),
        limit,
    ))


def _search_fuzzy(query: str, limit: int) -> list[Any]:
    return _unique_points(_scroll(
        Filter(should=[
            FieldCondition(key="style_name_text", match=MatchText(text=query)),
            FieldCondition(key="aliases_text", match=MatchText(text=query)),
        ]),
        limit,
    ))


def _search_semantic(query: str, limit: int) -> list[Any]:
    vector = encode_text(query)
    client = get_qdrant()
    result = client.query_points(
        collection_name=_style_collection_name(),
        query=vector,
        using="description",
        limit=limit,
        with_payload=True,
        score_threshold=settings.STYLE_KNOWLEDGE_SEMANTIC_SCORE_THRESHOLD,
    )
    return _unique_points(list(getattr(result, "points", [])))


def search_style_knowledge(query: str, *, limit: int = 5) -> dict[str, Any]:
    normalized_query = _normalize_query(query)
    if not normalized_query:
        return {
            "status": "invalid_query",
            "query": query,
            "message": "Style query must be a non-empty string.",
            "results": [],
        }

    exact_matches = _search_exact(normalized_query, limit)
    if exact_matches:
        primary = exact_matches[0]
        primary_payload = getattr(primary, "payload", {}) or {}
        primary_style_name = str(primary_payload.get("style_name", "")).strip()
        match_type = "name_exact" if primary_style_name == normalized_query else "alias_exact"
        return {
            "status": "ok",
            "query": normalized_query,
            "search_stage": "exact",
            "message": f'Found {len(exact_matches)} style match(es) for "{normalized_query}".',
            "primary_style": _point_to_slim(primary, match_type=match_type),
            "alternatives": [
                _point_to_slim(
                    point,
                    match_type=(
                        "name_exact"
                        if str((getattr(point, "payload", {}) or {}).get("style_name", "")).strip() == normalized_query
                        else "alias_exact"
                    ),
                )
                for point in exact_matches[1:limit]
            ],
            "style_features": _style_features(primary_payload),
            "retrieval_plan": build_style_retrieval_plan(primary_payload, user_query=normalized_query),
            "fallback_suggestion": None,
        }

    fuzzy_matches = _search_fuzzy(normalized_query, limit)
    if fuzzy_matches:
        primary = fuzzy_matches[0]
        primary_payload = getattr(primary, "payload", {}) or {}
        return {
            "status": "ok",
            "query": normalized_query,
            "search_stage": "fuzzy",
            "message": f'Found {len(fuzzy_matches)} fuzzy style match(es) for "{normalized_query}".',
            "primary_style": _point_to_slim(primary, match_type="fuzzy"),
            "alternatives": [_point_to_slim(point, match_type="fuzzy") for point in fuzzy_matches[1:limit]],
            "style_features": _style_features(primary_payload),
            "retrieval_plan": build_style_retrieval_plan(primary_payload, user_query=normalized_query),
            "fallback_suggestion": None,
        }

    semantic_matches = _search_semantic(normalized_query, limit)
    if semantic_matches:
        primary = semantic_matches[0]
        primary_payload = getattr(primary, "payload", {}) or {}
        return {
            "status": "ok",
            "query": normalized_query,
            "search_stage": "semantic",
            "message": f'Found {len(semantic_matches)} semantic style match(es) for "{normalized_query}".',
            "primary_style": _point_to_slim(primary, match_type="semantic", score=getattr(primary, "score", None)),
            "alternatives": [
                _point_to_slim(point, match_type="semantic", score=getattr(point, "score", None))
                for point in semantic_matches[1:limit]
            ],
            "style_features": _style_features(primary_payload),
            "retrieval_plan": build_style_retrieval_plan(primary_payload, user_query=normalized_query),
            "fallback_suggestion": None,
        }

    return {
        "status": "not_found",
        "query": normalized_query,
        "message": f'No style knowledge matched "{normalized_query}".',
        "results": [],
        "fallback_suggestion": (
            "Try a broader style phrase, or describe garments, palette, silhouette, and fabric directly."
        ),
    }
