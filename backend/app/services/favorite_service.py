from __future__ import annotations

import base64
import math
from pathlib import PurePosixPath
from typing import Any, Iterable
from uuid import uuid4

from ..agent.qdrant_utils import encode_image, get_collection as get_qdrant_collection_name
from ..agent.qdrant_utils import get_qdrant
from ..repositories import favorite_repo
from .oss_service import get_oss_service
from ..value_normalization import normalize_qdrant_point_id, normalize_quarter_value, normalize_text_value

DEFAULT_TASTE_VECTOR_TYPE = "fashion_clip"
ALLOWED_UPLOAD_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024


def _batched(values: Iterable[int | str], size: int = 64) -> Iterable[list[int | str]]:
    batch: list[int | str] = []
    for value in values:
        batch.append(value)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _normalize_vector(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(component * component for component in vector))
    if norm <= 1e-9:
        return vector
    return [component / norm for component in vector]


def _coerce_vector(value: Any) -> list[float] | None:
    if not isinstance(value, list) or not value:
        return None
    try:
        return [float(component) for component in value]
    except (TypeError, ValueError):
        return None


def rebuild_collection_profile(collection_id: str) -> dict[str, Any] | None:
    collection_row = favorite_repo.get_collection_row(collection_id)
    if not collection_row:
        return None

    preferred_vector_type = str(collection_row.get("profile_vector_type") or DEFAULT_TASTE_VECTOR_TYPE)
    sources = favorite_repo.list_collection_profile_sources(collection_id)
    favorite_repo.sync_collection_summary(collection_id)

    if not sources:
        return favorite_repo.update_collection_profile(
            collection_id,
            profile_status="empty",
            profile_vector=None,
            profile_vector_type=preferred_vector_type,
        )

    client = get_qdrant()
    collection_name = get_qdrant_collection_name()
    qdrant_point_ids: list[int | str] = []
    vectors: list[list[float]] = []

    for item in sources:
        source_type = str(item.get("source_type") or "catalog")
        if source_type == "upload":
            vector = _coerce_vector(item.get("embedding_vector"))
            if vector:
                vectors.append(_normalize_vector(vector))
            continue

        source_ref_id = item.get("source_ref_id") or item.get("image_id")
        point_id = normalize_qdrant_point_id(source_ref_id)
        if point_id is not None:
            qdrant_point_ids.append(point_id)

    for batch in _batched(qdrant_point_ids, 64):
        points = client.retrieve(
            collection_name=collection_name,
            ids=batch,
            with_vectors=[preferred_vector_type],
            with_payload=False,
        )
        for point in points:
            point_vectors = getattr(point, "vector", None)
            if not isinstance(point_vectors, dict):
                continue
            raw_vector = point_vectors.get(preferred_vector_type)
            if not isinstance(raw_vector, list) or not raw_vector:
                continue
            vectors.append(_normalize_vector([float(value) for value in raw_vector]))

    if not vectors:
        return favorite_repo.update_collection_profile(
            collection_id,
            profile_status="unavailable",
            profile_vector=None,
            profile_vector_type=preferred_vector_type,
        )

    dimension = len(vectors[0])
    centroid = [0.0] * dimension
    valid_count = 0
    for vector in vectors:
        if len(vector) != dimension:
            continue
        valid_count += 1
        for index, value in enumerate(vector):
            centroid[index] += value

    if valid_count == 0:
        return favorite_repo.update_collection_profile(
            collection_id,
            profile_status="unavailable",
            profile_vector=None,
            profile_vector_type=preferred_vector_type,
        )

    centroid = [value / valid_count for value in centroid]
    centroid = _normalize_vector(centroid)

    return favorite_repo.update_collection_profile(
        collection_id,
        profile_status="ready",
        profile_vector=centroid,
        profile_vector_type=preferred_vector_type,
    )


def list_collections(user_id: int) -> list[dict[str, Any]]:
    return favorite_repo.list_collections(user_id)


def get_collection_detail(user_id: int, collection_id: str, *, offset: int = 0, limit: int = 48) -> dict[str, Any] | None:
    return favorite_repo.get_collection_detail(user_id, collection_id, offset=offset, limit=limit)


def create_collection(user_id: int, *, name: str, description: str = "") -> dict[str, Any]:
    collection = favorite_repo.create_collection(user_id, name=name.strip(), description=description.strip())
    rebuild_collection_profile(collection["id"])
    return favorite_repo.get_collection(user_id, collection["id"]) or collection


def update_collection(
    user_id: int,
    collection_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
) -> dict[str, Any] | None:
    payload = favorite_repo.update_collection(
        user_id,
        collection_id,
        name=name.strip() if isinstance(name, str) else None,
        description=description.strip() if isinstance(description, str) else None,
    )
    if not payload:
        return None
    return favorite_repo.get_collection(user_id, collection_id) or payload


def delete_collection(user_id: int, collection_id: str) -> bool:
    collection = favorite_repo.get_collection(user_id, collection_id)
    if not collection:
        return False

    deleted = favorite_repo.delete_collection(user_id, collection_id)
    if not deleted:
        return False

    try:
        get_oss_service().delete_prefix(get_oss_service().collection_upload_prefix(user_id, collection_id))
    except Exception:
        pass
    return True


def add_item_to_collection(
    user_id: int,
    collection_id: str,
    *,
    image_id: str,
    image_url: str,
    brand: str | None = None,
    year: int | None = None,
    quarter: str | None = None,
    season: str | None = None,
    gender: str | None = None,
) -> dict[str, Any] | None:
    collection = favorite_repo.get_collection(user_id, collection_id)
    if not collection:
        return None

    favorite_repo.add_item(
        user_id,
        collection_id,
        image_id=image_id,
        image_url=image_url,
        brand=normalize_text_value(brand),
        year=year,
        quarter=normalize_quarter_value(quarter),
        season=normalize_text_value(season),
        gender=normalize_text_value(gender),
    )
    favorite_repo.sync_collection_summary(collection_id)
    rebuild_collection_profile(collection_id)
    return favorite_repo.get_collection_detail(user_id, collection_id, offset=0, limit=48)


def upload_item_to_collection(
    user_id: int,
    collection_id: str,
    *,
    filename: str | None,
    content_type: str | None,
    file_bytes: bytes,
) -> dict[str, Any] | None:
    collection = favorite_repo.get_collection(user_id, collection_id)
    if not collection:
        return None

    resolved_content_type = (content_type or "").split(";", 1)[0].strip().lower()
    if resolved_content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
        raise ValueError("Unsupported image format")
    if not file_bytes:
        raise ValueError("Empty upload")
    if len(file_bytes) > MAX_UPLOAD_SIZE_BYTES:
        raise ValueError("Image exceeds 10MB limit")

    safe_filename = PurePosixPath(filename or "reference-image").name or "reference-image"
    embedding_vector = _normalize_vector(
        encode_image(
            image_base64=base64.b64encode(file_bytes).decode("utf-8"),
            media_type=resolved_content_type,
        )
    )

    item_id = uuid4().hex
    public_item_id = f"upload:{item_id}"
    oss = get_oss_service()
    oss_path = oss.collection_upload_path(
        user_id=user_id,
        collection_id=collection_id,
        filename=safe_filename,
        content_type=resolved_content_type,
    )

    try:
        image_url = oss.upload_file(
            oss_path,
            file_bytes,
            content_type=resolved_content_type,
            metadata={"collection_id": collection_id, "source": "favorite_upload"},
        )
        inserted = favorite_repo.add_uploaded_item(
            user_id,
            collection_id,
            image_id=public_item_id,
            image_url=image_url,
            source_ref_id=item_id,
            original_filename=safe_filename,
            mime_type=resolved_content_type,
            embedding_vector=embedding_vector,
            embedding_vector_type=DEFAULT_TASTE_VECTOR_TYPE,
            storage_path=oss_path,
        )
        if not inserted:
            raise RuntimeError("Failed to persist uploaded collection item")
    except Exception:
        try:
            oss.delete_file(oss_path)
        except Exception:
            pass
        raise

    favorite_repo.sync_collection_summary(collection_id)
    rebuild_collection_profile(collection_id)
    return favorite_repo.get_collection_detail(user_id, collection_id, offset=0, limit=48)


def remove_item_from_collection(user_id: int, collection_id: str, image_id: str) -> dict[str, Any] | None:
    return remove_items_from_collection(user_id, collection_id, [image_id])


def remove_items_from_collection(user_id: int, collection_id: str, image_ids: list[str]) -> dict[str, Any] | None:
    collection = favorite_repo.get_collection(user_id, collection_id)
    if not collection:
        return None

    normalized_ids: list[str] = []
    seen: set[str] = set()
    for image_id in image_ids:
        normalized = str(image_id).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        normalized_ids.append(normalized)

    if not normalized_ids:
        return favorite_repo.get_collection_detail(user_id, collection_id, offset=0, limit=48)

    items = favorite_repo.list_items(user_id, collection_id, normalized_ids)
    favorite_repo.remove_items(user_id, collection_id, normalized_ids)
    favorite_repo.sync_collection_summary(collection_id)
    rebuild_collection_profile(collection_id)
    for item in items:
        if item.get("source_type") == "upload" and item.get("storage_path"):
            try:
                get_oss_service().delete_file(item["storage_path"])
            except Exception:
                pass
    return favorite_repo.get_collection_detail(user_id, collection_id, offset=0, limit=48)


def list_collections_for_image(user_id: int, image_id: str) -> list[dict[str, Any]]:
    return favorite_repo.list_collections_for_image(user_id, image_id)


def annotate_catalog_image_results(
    user_id: int,
    images: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized_ids: list[str] = []
    for image in images:
        image_id = str(image.get("image_id") or "").strip()
        if image_id:
            normalized_ids.append(image_id)

    collection_ids_by_image = favorite_repo.get_collection_ids_by_image_ids(
        user_id,
        normalized_ids,
    )

    annotated: list[dict[str, Any]] = []
    for image in images:
        payload = dict(image)
        image_id = str(payload.get("image_id") or "").strip()
        collection_ids = collection_ids_by_image.get(image_id, [])
        payload["favorite_collection_ids"] = collection_ids
        payload["is_favorited"] = len(collection_ids) > 0
        annotated.append(payload)
    return annotated
