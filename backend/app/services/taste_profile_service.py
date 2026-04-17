from __future__ import annotations

import json
import math
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from qdrant_client.models import FieldCondition, Filter, MatchAny

from ..agent.qdrant_utils import get_collection as get_qdrant_collection_name
from ..agent.qdrant_utils import get_qdrant
from ..config import settings
from ..repositories import favorite_repo, system_taste_profile_repo
from ..value_normalization import normalize_brand_key

DEFAULT_TASTE_BLEND_WEIGHT = 0.24
DEFAULT_TASTE_VECTOR_TYPE = "fashion_clip"
DEFAULT_SYSTEM_TASTE_BLEND_WEIGHT = 0.18
SYSTEM_TASTE_PROFILE_CACHE_TTL_SECONDS = 60.0
_SYSTEM_DNA_BRANDS_PATH = Path(__file__).resolve().parents[2] / "data" / "aimoda_system_dna_brands.json"
_SYSTEM_TASTE_PROFILE_CACHE: dict[str, tuple[float, list[float]]] = {}


class TasteProfileNotReadyError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_system_dna_brand_order() -> dict[str, int]:
    try:
        raw_payload = json.loads(_SYSTEM_DNA_BRANDS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}

    if not isinstance(raw_payload, list):
        return {}

    ordered: dict[str, int] = {}
    for index, item in enumerate(raw_payload):
        brand_key = normalize_brand_key(item)
        if brand_key and brand_key not in ordered:
            ordered[brand_key] = index
    return ordered


def clear_system_taste_profile_cache(vector_type: str | None = None) -> None:
    if vector_type is None:
        _SYSTEM_TASTE_PROFILE_CACHE.clear()
        return
    normalized_vector_type = str(vector_type or "").strip()
    if normalized_vector_type:
        _SYSTEM_TASTE_PROFILE_CACHE.pop(normalized_vector_type, None)


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


def _collect_brand_value_variants(client) -> dict[str, list[str]]:
    brand_order = _load_system_dna_brand_order()
    if not brand_order:
        return {}

    try:
        response = client.facet(
            collection_name=get_qdrant_collection_name(),
            key="brand",
            limit=max(int(getattr(settings, "AIMODA_SYSTEM_DNA_FACET_LIMIT", 4096) or 4096), 1),
            exact=False,
        )
    except Exception:
        return {}

    variants: dict[str, list[str]] = {}
    for hit in getattr(response, "hits", []) or []:
        value = getattr(hit, "value", None)
        if not isinstance(value, str) or not value.strip():
            continue
        brand_key = normalize_brand_key(value)
        if not brand_key or brand_key not in brand_order:
            continue
        brand_variants = variants.setdefault(brand_key, [])
        if value not in brand_variants:
            brand_variants.append(value)
    return variants


def _collect_brand_vectors(
    client,
    *,
    collection_name: str,
    brand_values: list[str],
    vector_type: str,
) -> list[list[float]]:
    if not brand_values:
        return []

    scroll_batch_size = max(int(getattr(settings, "AIMODA_SYSTEM_DNA_SCROLL_BATCH_SIZE", 128) or 128), 1)
    scroll_filter = Filter(must=[FieldCondition(key="brand", match=MatchAny(any=brand_values))])

    vectors: list[list[float]] = []
    next_offset: str | int | None = None
    while True:
        points, next_offset = client.scroll(
            collection_name=collection_name,
            scroll_filter=scroll_filter,
            limit=scroll_batch_size,
            offset=next_offset,
            with_payload=False,
            with_vectors=[vector_type],
        )
        if not points:
            break

        for point in points:
            point_vectors = getattr(point, "vector", None)
            if not isinstance(point_vectors, dict):
                continue
            raw_vector = point_vectors.get(vector_type)
            if not isinstance(raw_vector, list) or not raw_vector:
                continue
            vectors.append(_normalize_vector([float(value) for value in raw_vector]))

        if next_offset is None:
            break

    return vectors


def _centroid(vectors: list[list[float]]) -> list[float] | None:
    if not vectors:
        return None

    dimension = len(vectors[0])
    if dimension <= 0:
        return None

    centroid = [0.0] * dimension
    valid_count = 0
    for vector in vectors:
        if len(vector) != dimension:
            continue
        valid_count += 1
        for index, value in enumerate(vector):
            centroid[index] += value

    if valid_count <= 0:
        return None

    return _normalize_vector([value / valid_count for value in centroid])


def build_system_taste_profile(*, preferred_vector_type: str | None = None) -> tuple[list[float], str, dict[str, Any]]:
    vector_type = str(preferred_vector_type or DEFAULT_TASTE_VECTOR_TYPE).strip() or DEFAULT_TASTE_VECTOR_TYPE
    brand_order = _load_system_dna_brand_order()
    if not brand_order:
        raise TasteProfileNotReadyError("system taste profile missing")

    client = get_qdrant()
    collection_name = get_qdrant_collection_name()
    brand_variants = _collect_brand_value_variants(client)
    brand_centroids: list[list[float]] = []
    matched_brands = 0
    matched_images = 0

    for brand_key, _rank in sorted(brand_order.items(), key=lambda item: item[1]):
        variants = brand_variants.get(brand_key)
        if not variants:
            continue
        vectors = _collect_brand_vectors(
            client,
            collection_name=collection_name,
            brand_values=variants,
            vector_type=vector_type,
        )
        centroid = _centroid(vectors)
        if centroid is None:
            continue
        matched_brands += 1
        matched_images += len(vectors)
        brand_centroids.append(centroid)

    system_profile = _centroid(brand_centroids)
    if system_profile is None:
        raise TasteProfileNotReadyError("system taste profile unavailable")

    metadata = {
        "curated_brand_count": len(brand_order),
        "matched_brand_count": matched_brands,
        "matched_image_count": matched_images,
        "vector_dimension": len(system_profile),
    }
    return system_profile, vector_type, metadata


def rebuild_system_taste_profile(*, preferred_vector_type: str | None = None) -> dict[str, Any]:
    vector_type = str(preferred_vector_type or DEFAULT_TASTE_VECTOR_TYPE).strip() or DEFAULT_TASTE_VECTOR_TYPE
    try:
        profile_vector, profile_vector_type, metadata = build_system_taste_profile(
            preferred_vector_type=vector_type,
        )
        row = system_taste_profile_repo.upsert_system_taste_profile(
            profile_status="ready",
            profile_vector=profile_vector,
            profile_vector_type=profile_vector_type,
            metadata=metadata,
        )
    except TasteProfileNotReadyError:
        row = system_taste_profile_repo.upsert_system_taste_profile(
            profile_status="unavailable",
            profile_vector=None,
            profile_vector_type=vector_type,
            metadata={
                "curated_brand_count": len(_load_system_dna_brand_order()),
                "matched_brand_count": 0,
                "matched_image_count": 0,
            },
        )
        clear_system_taste_profile_cache(vector_type)
        raise

    clear_system_taste_profile_cache(profile_vector_type)
    _SYSTEM_TASTE_PROFILE_CACHE[profile_vector_type] = (time.monotonic(), profile_vector)
    return row


def get_system_taste_profile_status() -> dict[str, Any] | None:
    return system_taste_profile_repo.get_system_taste_profile()


def get_system_taste_profile(*, preferred_vector_type: str | None = None) -> tuple[list[float], str]:
    vector_type = str(preferred_vector_type or DEFAULT_TASTE_VECTOR_TYPE).strip() or DEFAULT_TASTE_VECTOR_TYPE
    cache_ttl_seconds = max(
        float(getattr(settings, "AIMODA_SYSTEM_DNA_CACHE_TTL_SECONDS", SYSTEM_TASTE_PROFILE_CACHE_TTL_SECONDS) or SYSTEM_TASTE_PROFILE_CACHE_TTL_SECONDS),
        0.0,
    )
    cached = _SYSTEM_TASTE_PROFILE_CACHE.get(vector_type)
    if cached and (cache_ttl_seconds <= 0 or (time.monotonic() - cached[0]) < cache_ttl_seconds):
        return cached[1], vector_type

    row = system_taste_profile_repo.get_system_taste_profile()
    if not row or row.get("profile_status") != "ready":
        raise TasteProfileNotReadyError("system taste profile not ready")
    if str(row.get("profile_vector_type") or DEFAULT_TASTE_VECTOR_TYPE) != vector_type:
        raise TasteProfileNotReadyError("system taste profile vector mismatch")

    raw_vector = row.get("profile_vector")
    if not isinstance(raw_vector, list) or not raw_vector:
        raise TasteProfileNotReadyError("system taste profile empty")

    normalized_vector = _normalize_vector([float(value) for value in raw_vector])
    _SYSTEM_TASTE_PROFILE_CACHE[vector_type] = (time.monotonic(), normalized_vector)
    return normalized_vector, vector_type


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
    system_blend_weight: float | None = None,
) -> tuple[list[float] | None, str | None]:
    """Blend either the system DNA or the user DNA into the raw query embedding."""
    if query_vector is None:
        return query_vector, query_vector_type

    effective_vector = _normalize_vector([float(value) for value in query_vector])
    effective_vector_type = str(query_vector_type or "").strip() or DEFAULT_TASTE_VECTOR_TYPE

    if taste_profile_id:
        try:
            taste_vector, taste_vector_type = get_taste_profile(user_id, taste_profile_id)
        except TasteProfileNotReadyError:
            return effective_vector, effective_vector_type

        if effective_vector_type != taste_vector_type:
            return effective_vector, effective_vector_type

        fused_vector = _blend_vectors(
            effective_vector,
            taste_vector,
            blend_weight=blend_weight,
        )
        if fused_vector is None:
            return effective_vector, effective_vector_type
        return fused_vector, effective_vector_type

    default_system_weight = float(
        getattr(settings, "AIMODA_SYSTEM_DNA_BLEND_WEIGHT", DEFAULT_SYSTEM_TASTE_BLEND_WEIGHT)
        or DEFAULT_SYSTEM_TASTE_BLEND_WEIGHT
    )
    system_weight = normalize_taste_blend_weight(
        system_blend_weight,
        default=default_system_weight,
    )
    if system_weight <= 0:
        return effective_vector, effective_vector_type

    try:
        system_vector, system_vector_type = get_system_taste_profile(
            preferred_vector_type=effective_vector_type,
        )
    except TasteProfileNotReadyError:
        return effective_vector, effective_vector_type

    if system_vector_type != effective_vector_type:
        return effective_vector, effective_vector_type

    fused_vector = _blend_vectors(
        effective_vector,
        system_vector,
        blend_weight=system_weight,
    )
    if fused_vector is None:
        return effective_vector, effective_vector_type
    return fused_vector, effective_vector_type


def rerank_image_candidates(
    user_id: int,
    taste_profile_id: str | None,
    candidates: list[dict[str, Any]],
    *,
    blend_weight: float = DEFAULT_TASTE_BLEND_WEIGHT,
) -> list[dict[str, Any]]:
    """Legacy compatibility wrapper.

    DNA preferences now apply at query-embedding time instead of post-retrieval,
    so candidate ordering is left unchanged here.
    """
    return candidates
