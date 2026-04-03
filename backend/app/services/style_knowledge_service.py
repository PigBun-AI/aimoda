from __future__ import annotations

import re
from typing import Any

from qdrant_client.models import FieldCondition, Filter, MatchText, MatchValue

from ..agent.qdrant_utils import encode_style_text, get_qdrant
from ..config import settings


def _style_collection_name() -> str:
    return settings.STYLE_KNOWLEDGE_COLLECTION


def _normalize_query(query: str) -> str:
    return " ".join((query or "").strip().split())


def _normalize_exact_token(value: str) -> str:
    normalized = _normalize_query(value).lower()
    normalized = normalized.replace("_", " ").replace("-", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


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


def _normalize_string_list(values: list[Any], *, limit: int | None = None) -> list[str]:
    cleaned = [str(item).strip() for item in values if str(item).strip()]
    unique = list(dict.fromkeys(cleaned))
    return unique if limit is None else unique[:limit]


def build_style_rich_text(style: dict[str, Any]) -> str:
    existing = str(style.get("rich_text", "")).strip()
    if existing:
        return existing

    aliases = _normalize_string_list(style.get("aliases", []), limit=8)
    palette = _normalize_string_list(style.get("palette", []), limit=6)
    silhouettes = _normalize_string_list(style.get("silhouette", []), limit=6)
    fabrics = _normalize_string_list(style.get("fabric", []), limit=6)
    details = _normalize_string_list(style.get("details", []), limit=8)
    brands = _normalize_string_list(style.get("reference_brands", []), limit=6)
    seasons = _normalize_string_list(style.get("season_relevance", []), limit=4)
    visual_description = _normalize_query(str(style.get("visual_description", "")))
    category = str(style.get("category", "")).strip()
    gender = str(style.get("gender", "")).strip()

    sections: list[str] = []
    style_name = str(style.get("style_name", "")).strip()
    if style_name:
        sections.append(f"style_name: {style_name}")
    if aliases:
        sections.append(f"aliases: {', '.join(aliases)}")
    if category:
        sections.append(f"category: {category}")
    if gender:
        sections.append(f"gender: {gender}")
    if visual_description:
        sections.append(f"visual_description: {visual_description}")
    if palette:
        sections.append(f"palette: {', '.join(palette)}")
    if silhouettes:
        sections.append(f"silhouette: {', '.join(silhouettes)}")
    if fabrics:
        sections.append(f"fabric: {', '.join(fabrics)}")
    if details:
        sections.append(f"details: {', '.join(details)}")
    if brands:
        sections.append(f"reference_brands: {', '.join(brands)}")
    if seasons:
        sections.append(f"season_relevance: {', '.join(seasons)}")

    return "\n".join(section for section in sections if section)


def _style_features(style: dict[str, Any]) -> dict[str, Any]:
    visual_description = _compact_visual_description(str(style.get("visual_description", "")).strip())
    palette = _normalize_string_list(style.get("palette", []), limit=4)
    silhouettes = _normalize_string_list(style.get("silhouette", []), limit=3)
    fabrics = _normalize_string_list(style.get("fabric", []), limit=3)
    details = _normalize_string_list(style.get("details", []), limit=4)
    brands = _normalize_string_list(style.get("reference_brands", []), limit=4)
    seasons = _normalize_string_list(style.get("season_relevance", []), limit=3)
    gender = str(style.get("gender", "")).strip()

    return {
        "visual_description_en": visual_description,
        "palette": palette,
        "silhouette": silhouettes,
        "fabric": fabrics,
        "details": details,
        "reference_brands": brands,
        "season_relevance": seasons,
        "gender": gender,
    }


def build_style_retrieval_plan(style: dict[str, Any], *, user_query: str) -> dict[str, Any]:
    features = _style_features(style)
    rich_text = build_style_rich_text(style)

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
        "style_rich_text": rich_text,
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
                "Use style_rich_text as the semantic grounding text, optionally combine it with the user's direct query, "
                "then apply only high-confidence concrete filters such as fabric, silhouette, season, or gender if the user needs more precision. "
                "If no single garment category is resolved yet, keep palette/fabric cues inside semantic retrieval instead of calling add_filter(...) immediately."
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
    normalized = _normalize_exact_token(query)
    return _unique_points(_scroll(
        Filter(should=[
            FieldCondition(key="style_name_norm", match=MatchValue(value=normalized)),
            FieldCondition(key="aliases_norm", match=MatchValue(value=normalized)),
            FieldCondition(key="style_name", match=MatchValue(value=query)),
            FieldCondition(key="aliases", match=MatchValue(value=query)),
        ]),
        limit,
    ))


def _search_fuzzy(query: str, limit: int) -> list[Any]:
    normalized = _normalize_exact_token(query)
    return _unique_points(_scroll(
        Filter(should=[
            FieldCondition(key="style_name_text", match=MatchText(text=normalized)),
            FieldCondition(key="aliases_text", match=MatchText(text=normalized)),
            FieldCondition(key="rich_text_text", match=MatchText(text=normalized)),
        ]),
        limit,
    ))


def _search_semantic(query: str, limit: int) -> list[Any]:
    vector = encode_style_text(query)
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


def _build_search_response(*, query: str, search_stage: str, match_type: str, primary: Any, alternatives: list[Any]) -> dict[str, Any]:
    primary_payload = getattr(primary, "payload", {}) or {}
    return {
        "status": "ok",
        "query": query,
        "search_stage": search_stage,
        "message": f'Found {1 + len(alternatives)} {search_stage} style match(es) for "{query}".',
        "primary_style": _point_to_slim(primary, match_type=match_type, score=getattr(primary, "score", None) if match_type == "semantic" else None),
        "alternatives": [
            _point_to_slim(point, match_type=match_type, score=getattr(point, "score", None) if match_type == "semantic" else None)
            for point in alternatives
        ],
        "rich_text": build_style_rich_text(primary_payload),
        "rich_text_summary": _compact_visual_description(str(primary_payload.get("visual_description", "")).strip()),
        "style_features": _style_features(primary_payload),
        "retrieval_plan": build_style_retrieval_plan(primary_payload, user_query=query),
        "fallback_suggestion": None,
    }


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
        match_type = (
            "name_exact"
            if str(primary_payload.get("style_name_norm", "")).strip() == _normalize_exact_token(normalized_query)
            else "alias_exact"
        )
        return _build_search_response(
            query=normalized_query,
            search_stage="exact",
            match_type=match_type,
            primary=primary,
            alternatives=exact_matches[1:limit],
        )

    fuzzy_matches = _search_fuzzy(normalized_query, limit)
    if fuzzy_matches:
        return _build_search_response(
            query=normalized_query,
            search_stage="fuzzy",
            match_type="fuzzy",
            primary=fuzzy_matches[0],
            alternatives=fuzzy_matches[1:limit],
        )

    semantic_matches = _search_semantic(normalized_query, limit)
    if semantic_matches:
        return _build_search_response(
            query=normalized_query,
            search_stage="semantic",
            match_type="semantic",
            primary=semantic_matches[0],
            alternatives=semantic_matches[1:limit],
        )

    return {
        "status": "not_found",
        "query": normalized_query,
        "search_stage": "not_found",
        "message": f'No style knowledge matched "{normalized_query}".',
        "results": [],
        "fallback_suggestion": (
            "Try a broader style phrase, or describe garments, palette, silhouette, and fabric directly."
        ),
    }
