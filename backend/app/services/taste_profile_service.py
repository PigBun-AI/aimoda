from __future__ import annotations

import math
from typing import Any

from ..agent.qdrant_utils import get_collection as get_qdrant_collection_name
from ..agent.qdrant_utils import get_qdrant
from ..repositories import favorite_repo
from ..value_normalization import normalize_qdrant_point_id

DEFAULT_TASTE_BLEND_WEIGHT = 0.24
DEFAULT_TASTE_VECTOR_TYPE = "fashion_clip"


class TasteProfileNotReadyError(RuntimeError):
    pass


def normalize_taste_blend_weight(value: Any, *, default: float = DEFAULT_TASTE_BLEND_WEIGHT) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = default
    return max(0.0, min(1.0, numeric))


def _normalize_vector(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm <= 1e-9:
        return vector
    return [value / norm for value in vector]


def _blend_vectors(
    base_vector: list[float],
    taste_vector: list[float],
    *,
    blend_weight: float,
) -> list[float] | None:
    if len(base_vector) != len(taste_vector) or not base_vector:
        return None

    alpha = normalize_taste_blend_weight(blend_weight)
    fused = [
        ((1.0 - alpha) * base_value) + (alpha * taste_value)
        for base_value, taste_value in zip(base_vector, taste_vector)
    ]
    return _normalize_vector(fused)


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def _normalize_base_scores(candidates: list[dict[str, Any]]) -> list[float]:
    explicit_scores = [candidate.get("base_score") for candidate in candidates]
    if all(isinstance(score, (int, float)) for score in explicit_scores):
        numeric_scores = [float(score) for score in explicit_scores]
        score_min = min(numeric_scores)
        score_max = max(numeric_scores)
        if score_max - score_min > 1e-9:
            return [(score - score_min) / (score_max - score_min) for score in numeric_scores]

    total = max(len(candidates) - 1, 1)
    return [1.0 - (index / total) for index in range(len(candidates))]


def get_taste_profile(user_id: int, taste_profile_id: str) -> tuple[list[float], str]:
    collection = favorite_repo.get_collection(user_id, taste_profile_id)
    if not collection:
        raise TasteProfileNotReadyError("taste profile missing")

    raw_row = favorite_repo.get_collection_row(taste_profile_id)
    if not raw_row:
        raise TasteProfileNotReadyError("taste profile missing")

    raw_vector = raw_row.get("profile_vector")
    if not isinstance(raw_vector, list) or not raw_vector:
        raise TasteProfileNotReadyError("taste profile empty")

    profile_status = str(raw_row.get("profile_status") or "empty")
    if profile_status != "ready":
        raise TasteProfileNotReadyError("taste profile not ready")

    vector_type = str(raw_row.get("profile_vector_type") or DEFAULT_TASTE_VECTOR_TYPE)
    return _normalize_vector([float(value) for value in raw_vector]), vector_type


def apply_taste_profile_to_query(
    user_id: int,
    taste_profile_id: str | None,
    *,
    query_vector: list[float] | None,
    query_vector_type: str | None,
    blend_weight: float = DEFAULT_TASTE_BLEND_WEIGHT,
) -> tuple[list[float] | None, str | None]:
    """Condition the query embedding with the user's collection DNA.

    This is retrieval-time query steering, not post-retrieval reranking.
    If the base query has no vector, the taste vector itself becomes the
    ranking query. If vector spaces mismatch, the original query is kept.
    """
    if not taste_profile_id:
        return query_vector, query_vector_type

    try:
        taste_vector, taste_vector_type = get_taste_profile(user_id, taste_profile_id)
    except TasteProfileNotReadyError:
        return query_vector, query_vector_type

    if query_vector is None:
        return taste_vector, taste_vector_type

    normalized_query_vector = _normalize_vector([float(value) for value in query_vector])
    normalized_query_type = str(query_vector_type or "").strip() or taste_vector_type
    if normalized_query_type != taste_vector_type:
        return normalized_query_vector, normalized_query_type

    fused_vector = _blend_vectors(
        normalized_query_vector,
        taste_vector,
        blend_weight=blend_weight,
    )
    if fused_vector is None:
        return normalized_query_vector, normalized_query_type
    return fused_vector, normalized_query_type


def rerank_image_candidates(
    user_id: int,
    taste_profile_id: str | None,
    candidates: list[dict[str, Any]],
    *,
    blend_weight: float = DEFAULT_TASTE_BLEND_WEIGHT,
) -> list[dict[str, Any]]:
    if not taste_profile_id or not candidates:
        return candidates
    blend_weight = normalize_taste_blend_weight(blend_weight)

    try:
        taste_vector, vector_type = get_taste_profile(user_id, taste_profile_id)
    except TasteProfileNotReadyError:
        return candidates

    point_ids = [point_id for candidate in candidates if (point_id := normalize_qdrant_point_id(candidate.get("image_id"))) is not None]
    if not point_ids:
        return candidates

    client = get_qdrant()
    collection_name = get_qdrant_collection_name()
    points = client.retrieve(
        collection_name=collection_name,
        ids=point_ids,
        with_vectors=[vector_type],
        with_payload=False,
    )
    vector_map: dict[str, list[float]] = {}
    for point in points:
        raw_vectors = getattr(point, "vector", None)
        if not isinstance(raw_vectors, dict):
            continue
        raw_vector = raw_vectors.get(vector_type)
        if not isinstance(raw_vector, list) or not raw_vector:
            continue
        vector_map[str(point.id)] = _normalize_vector([float(value) for value in raw_vector])

    if not vector_map:
        return candidates

    base_scores = _normalize_base_scores(candidates)
    weighted_candidates: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates):
        image_id = str(candidate.get("image_id") or "")
        candidate_vector = vector_map.get(image_id)
        similarity = _cosine_similarity(taste_vector, candidate_vector) if candidate_vector else 0.0
        candidate["taste_similarity"] = similarity
        similarity_normalized = max(0.0, min(1.0, (similarity + 1.0) / 2.0))
        final_score = (base_scores[index] * (1.0 - blend_weight)) + (similarity_normalized * blend_weight)
        candidate["taste_rank_score"] = final_score
        weighted_candidates.append(candidate)

    weighted_candidates.sort(
        key=lambda candidate: (
            -float(candidate.get("taste_rank_score") or 0.0),
            -float(candidate.get("base_score") or 0.0),
            int(candidate.get("base_rank") or 0),
        )
    )
    return weighted_candidates
