from __future__ import annotations

from typing import Any

from ..agent.qdrant_utils import get_collection as get_qdrant_collection_name
from ..agent.qdrant_utils import get_qdrant
from ..repositories import favorite_repo
from ..services.favorite_service import rebuild_collection_profile
from ..value_normalization import normalize_qdrant_point_id, normalize_text_value


def delete_catalog_image(image_id: str) -> dict[str, Any] | None:
    normalized_image_id = str(image_id).strip()
    if not normalized_image_id:
        return None

    client = get_qdrant()
    collection_name = get_qdrant_collection_name()
    point_id = normalize_qdrant_point_id(normalized_image_id)

    lookup_ids: list[int | str] = []
    if point_id is not None:
        lookup_ids.append(point_id)
    if normalized_image_id not in lookup_ids:
        lookup_ids.append(normalized_image_id)

    point = None
    for lookup_id in lookup_ids:
        points = client.retrieve(
            collection_name=collection_name,
            ids=[lookup_id],
            with_payload=True,
        )
        if points:
            point = points[0]
            break

    if point is None:
        return None

    payload = dict(getattr(point, "payload", {}) or {})
    resolved_point_id = getattr(point, "id", None)
    if resolved_point_id is None:
        resolved_point_id = point_id if point_id is not None else normalized_image_id

    client.delete(
        collection_name=collection_name,
        points_selector=[resolved_point_id],
        wait=True,
    )

    affected_collection_ids = favorite_repo.remove_catalog_items_by_source_ref(normalized_image_id)
    for collection_id in affected_collection_ids:
        favorite_repo.sync_collection_summary(collection_id)
        rebuild_collection_profile(collection_id)

    return {
        "image_id": normalized_image_id,
        "image_url": payload.get("image_url", ""),
        "brand": normalize_text_value(payload.get("brand")) or "",
        "removed_collection_count": len(affected_collection_ids),
        "affected_collection_ids": affected_collection_ids,
    }
