from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from ..postgres import pg_connection

_COLLECTION_COLUMNS = """
    id,
    user_id,
    name,
    description,
    cover_image_id,
    cover_image_url,
    profile_status,
    profile_vector_type,
    item_count,
    created_at,
    updated_at
"""

_COLLECTION_INTERNAL_COLUMNS = """
    id,
    user_id,
    name,
    description,
    cover_image_id,
    cover_image_url,
    profile_status,
    profile_vector,
    profile_vector_type,
    item_count,
    created_at,
    updated_at
"""

_ITEM_COLUMNS = """
    id,
    collection_id,
    image_id,
    image_url,
    storage_path,
    source_type,
    source_ref_id,
    original_filename,
    mime_type,
    embedding_vector_type,
    brand,
    year,
    quarter,
    season,
    gender,
    added_at,
    updated_at
"""


def _qualified_collection_columns(alias: str) -> str:
    return f"""
    {alias}.id,
    {alias}.user_id,
    {alias}.name,
    {alias}.description,
    {alias}.cover_image_id,
    {alias}.cover_image_url,
    {alias}.profile_status,
    {alias}.profile_vector_type,
    {alias}.item_count,
    {alias}.created_at,
    {alias}.updated_at
    """


def _qualified_item_columns(alias: str) -> str:
    return f"""
    {alias}.id,
    {alias}.collection_id,
    {alias}.image_id,
    {alias}.image_url,
    {alias}.storage_path,
    {alias}.source_type,
    {alias}.source_ref_id,
    {alias}.original_filename,
    {alias}.mime_type,
    {alias}.embedding_vector_type,
    {alias}.brand,
    {alias}.year,
    {alias}.quarter,
    {alias}.season,
    {alias}.gender,
    {alias}.added_at,
    {alias}.updated_at
"""


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _serialize_item(row: dict[str, Any]) -> dict[str, Any]:
    source_type = row.get("source_type") or "catalog"
    image_id = row.get("image_id")
    return {
        "id": row.get("id"),
        "collection_id": row.get("collection_id"),
        "image_id": image_id,
        "image_url": row.get("image_url") or "",
        "storage_path": row.get("storage_path") or "",
        "source_type": source_type,
        "source_ref_id": row.get("source_ref_id") or image_id,
        "original_filename": row.get("original_filename") or "",
        "mime_type": row.get("mime_type") or "",
        "embedding_vector_type": row.get("embedding_vector_type") or "fashion_clip",
        "brand": row.get("brand") or "",
        "year": row.get("year"),
        "quarter": row.get("quarter"),
        "season": row.get("season"),
        "gender": row.get("gender"),
        "detail_image_id": image_id if source_type == "catalog" else None,
        "added_at": _iso(row.get("added_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def _serialize_collection(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "user_id": row.get("user_id"),
        "name": row.get("name") or "",
        "description": row.get("description") or "",
        "cover_image_id": row.get("cover_image_id"),
        "cover_image_url": row.get("cover_image_url") or "",
        "profile_status": row.get("profile_status") or "empty",
        "profile_vector_type": row.get("profile_vector_type") or "fashion_clip",
        "item_count": int(row.get("item_count") or 0),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def list_collections(user_id: int) -> list[dict[str, Any]]:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    {_COLLECTION_COLUMNS},
                    COALESCE((
                        SELECT json_agg(
                            json_build_object(
                                'image_id', preview.image_id,
                                'image_url', preview.image_url,
                                'source_type', preview.source_type,
                                'brand', preview.brand,
                                'year', preview.year,
                                'quarter', preview.quarter,
                                'season', preview.season
                            )
                            ORDER BY preview.added_at DESC
                        )
                        FROM (
                            SELECT image_id, image_url, source_type, brand, year, quarter, season, added_at
                            FROM favorite_collection_items
                            WHERE collection_id = favorite_collections.id
                            ORDER BY added_at DESC
                            LIMIT 4
                        ) AS preview
                    ), '[]'::json) AS preview_items
                FROM favorite_collections
                WHERE user_id = %s
                ORDER BY updated_at DESC, created_at DESC, id DESC
                """,
                [user_id],
            )
            rows = cur.fetchall()

    collections: list[dict[str, Any]] = []
    for row in rows:
        payload = _serialize_collection(dict(row))
        payload["preview_items"] = row.get("preview_items") or []
        can_apply_as_dna = payload["profile_status"] == "ready" and payload["item_count"] > 0
        payload["can_apply_as_dna"] = can_apply_as_dna
        payload["can_apply_as_taste"] = can_apply_as_dna
        collections.append(payload)
    return collections


def get_collection(user_id: int, collection_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_COLLECTION_COLUMNS}
                FROM favorite_collections
                WHERE id = %s AND user_id = %s
                """,
                [collection_id, user_id],
            )
            row = cur.fetchone()
    return _serialize_collection(dict(row)) if row else None


def get_collection_row(collection_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {_COLLECTION_INTERNAL_COLUMNS} FROM favorite_collections WHERE id = %s",
                [collection_id],
            )
            row = cur.fetchone()
    return dict(row) if row else None


def get_collection_detail(user_id: int, collection_id: str, *, offset: int = 0, limit: int = 48) -> dict[str, Any] | None:
    collection = get_collection(user_id, collection_id)
    if not collection:
        return None

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_ITEM_COLUMNS}
                FROM favorite_collection_items
                WHERE collection_id = %s
                ORDER BY added_at DESC, id DESC
                LIMIT %s OFFSET %s
                """,
                [collection_id, limit, offset],
            )
            items = [_serialize_item(dict(row)) for row in cur.fetchall()]

    collection["items"] = items
    collection["offset"] = offset
    collection["limit"] = limit
    collection["has_more"] = offset + limit < collection["item_count"]
    can_apply_as_dna = collection["profile_status"] == "ready" and collection["item_count"] > 0
    collection["can_apply_as_dna"] = can_apply_as_dna
    collection["can_apply_as_taste"] = can_apply_as_dna
    return collection


def create_collection(user_id: int, *, name: str, description: str = "") -> dict[str, Any]:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO favorite_collections (user_id, name, description)
                VALUES (%s, %s, %s)
                RETURNING {_COLLECTION_COLUMNS}
                """,
                [user_id, name, description],
            )
            row = cur.fetchone()
            conn.commit()
    return _serialize_collection(dict(row))


def update_collection(
    user_id: int,
    collection_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
) -> dict[str, Any] | None:
    assignments: list[str] = []
    params: list[Any] = []

    if name is not None:
        assignments.append("name = %s")
        params.append(name)
    if description is not None:
        assignments.append("description = %s")
        params.append(description)

    if not assignments:
        return get_collection(user_id, collection_id)

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE favorite_collections
                SET {', '.join(assignments)}, updated_at = NOW()
                WHERE id = %s AND user_id = %s
                RETURNING {_COLLECTION_COLUMNS}
                """,
                params + [collection_id, user_id],
            )
            row = cur.fetchone()
            conn.commit()
    return _serialize_collection(dict(row)) if row else None


def delete_collection(user_id: int, collection_id: str) -> bool:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM favorite_collections WHERE id = %s AND user_id = %s RETURNING id",
                [collection_id, user_id],
            )
            row = cur.fetchone()
            conn.commit()
    return row is not None


def list_collection_profile_sources(collection_id: str) -> list[dict[str, Any]]:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT source_type, source_ref_id, image_id, embedding_vector, embedding_vector_type
                FROM favorite_collection_items
                WHERE collection_id = %s
                ORDER BY added_at DESC, id DESC
                """,
                [collection_id],
            )
            rows = cur.fetchall()
    return [dict(row) for row in rows]


def add_item(
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
) -> bool:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO favorite_collection_items (
                    collection_id,
                    image_id,
                    image_url,
                    source_type,
                    source_ref_id,
                    brand,
                    year,
                    quarter,
                    season,
                    gender,
                    embedding_vector,
                    embedding_vector_type,
                    original_filename,
                    mime_type
                )
                SELECT id, %s, %s, 'catalog', %s, %s, %s, %s, %s, %s, NULL, 'fashion_clip', NULL, NULL
                FROM favorite_collections
                WHERE id = %s AND user_id = %s
                ON CONFLICT (collection_id, source_type, source_ref_id) DO NOTHING
                RETURNING id
                """,
                [image_id, image_url, image_id, brand, year, quarter, season, gender, collection_id, user_id],
            )
            row = cur.fetchone()
            conn.commit()
    return row is not None


def add_uploaded_item(
    user_id: int,
    collection_id: str,
    *,
    image_id: str,
    image_url: str,
    source_ref_id: str,
    original_filename: str | None,
    mime_type: str | None,
    embedding_vector: list[float],
    embedding_vector_type: str,
    storage_path: str | None,
) -> bool:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO favorite_collection_items (
                    collection_id,
                    image_id,
                    image_url,
                    source_type,
                    source_ref_id,
                    storage_path,
                    original_filename,
                    mime_type,
                    embedding_vector,
                    embedding_vector_type
                )
                SELECT id, %s, %s, 'upload', %s, %s, %s, %s, %s, %s
                FROM favorite_collections
                WHERE id = %s AND user_id = %s
                ON CONFLICT (collection_id, source_type, source_ref_id) DO NOTHING
                RETURNING id
                """,
                [
                    image_id,
                    image_url,
                    source_ref_id,
                    storage_path,
                    original_filename,
                    mime_type,
                    Jsonb(embedding_vector),
                    embedding_vector_type,
                    collection_id,
                    user_id,
                ],
            )
            row = cur.fetchone()
            conn.commit()
    return row is not None


def get_item(user_id: int, collection_id: str, image_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_qualified_item_columns("item")}
                FROM favorite_collection_items AS item
                INNER JOIN favorite_collections AS collection
                    ON collection.id = item.collection_id
                WHERE collection.user_id = %s
                  AND item.collection_id = %s
                  AND item.image_id = %s
                LIMIT 1
                """,
                [user_id, collection_id, image_id],
            )
            row = cur.fetchone()
    return _serialize_item(dict(row)) if row else None


def list_items(user_id: int, collection_id: str, image_ids: list[str]) -> list[dict[str, Any]]:
    normalized_ids = [str(image_id).strip() for image_id in image_ids if str(image_id).strip()]
    if not normalized_ids:
        return []

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_qualified_item_columns("item")}
                FROM favorite_collection_items AS item
                INNER JOIN favorite_collections AS collection
                    ON collection.id = item.collection_id
                WHERE collection.user_id = %s
                  AND item.collection_id = %s
                  AND item.image_id = ANY(%s)
                ORDER BY item.added_at DESC, item.id DESC
                """,
                [user_id, collection_id, normalized_ids],
            )
            rows = cur.fetchall()
    return [_serialize_item(dict(row)) for row in rows]


def remove_item(user_id: int, collection_id: str, image_id: str) -> bool:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM favorite_collection_items item
                USING favorite_collections collection
                WHERE item.collection_id = collection.id
                  AND item.collection_id = %s
                  AND item.image_id = %s
                  AND collection.id = %s
                  AND collection.user_id = %s
                RETURNING item.id
                """,
                [collection_id, image_id, collection_id, user_id],
            )
            row = cur.fetchone()
            conn.commit()
    return row is not None


def remove_items(user_id: int, collection_id: str, image_ids: list[str]) -> int:
    normalized_ids = [str(image_id).strip() for image_id in image_ids if str(image_id).strip()]
    if not normalized_ids:
        return 0

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM favorite_collection_items AS item
                USING favorite_collections AS collection
                WHERE item.collection_id = collection.id
                  AND item.collection_id = %s
                  AND item.image_id = ANY(%s)
                  AND collection.id = %s
                  AND collection.user_id = %s
                RETURNING item.id
                """,
                [collection_id, normalized_ids, collection_id, user_id],
            )
            removed_count = len(cur.fetchall())
            conn.commit()
    return removed_count


def remove_catalog_items_by_source_ref(image_id: str) -> list[str]:
    normalized_image_id = str(image_id).strip()
    if not normalized_image_id:
        return []

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM favorite_collection_items
                WHERE source_type = 'catalog'
                  AND source_ref_id = %s
                RETURNING collection_id
                """,
                [normalized_image_id],
            )
            rows = cur.fetchall()
            conn.commit()

    collection_ids: list[str] = []
    seen: set[str] = set()
    for row in rows:
        collection_id = str(row.get("collection_id") or "").strip()
        if not collection_id or collection_id in seen:
            continue
        seen.add(collection_id)
        collection_ids.append(collection_id)
    return collection_ids


def list_collections_for_image(user_id: int, image_id: str) -> list[dict[str, Any]]:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    collection.id,
                    collection.user_id,
                    collection.name,
                    collection.description,
                    collection.cover_image_id,
                    collection.cover_image_url,
                    collection.profile_status,
                    collection.profile_vector,
                    collection.profile_vector_type,
                    collection.item_count,
                    collection.created_at,
                    collection.updated_at,
                    item.added_at AS matched_added_at
                FROM favorite_collections AS collection
                INNER JOIN favorite_collection_items AS item
                    ON item.collection_id = collection.id
                WHERE collection.user_id = %s
                  AND item.source_type = 'catalog'
                  AND item.source_ref_id = %s
                ORDER BY item.added_at DESC
                """,
                [user_id, image_id],
            )
            rows = cur.fetchall()

    collections: list[dict[str, Any]] = []
    for row in rows:
        payload = _serialize_collection(dict(row))
        payload["matched_added_at"] = _iso(row.get("matched_added_at"))
        can_apply_as_dna = payload["profile_status"] == "ready" and payload["item_count"] > 0
        payload["can_apply_as_dna"] = can_apply_as_dna
        payload["can_apply_as_taste"] = can_apply_as_dna
        collections.append(payload)
    return collections


def get_collection_ids_by_image_ids(user_id: int, image_ids: list[str]) -> dict[str, list[str]]:
    normalized_ids = [str(image_id).strip() for image_id in image_ids if str(image_id).strip()]
    if not normalized_ids:
        return {}

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT item.source_ref_id AS image_id, item.collection_id
                FROM favorite_collection_items AS item
                INNER JOIN favorite_collections AS collection
                    ON collection.id = item.collection_id
                WHERE collection.user_id = %s
                  AND item.source_type = 'catalog'
                  AND item.source_ref_id = ANY(%s)
                ORDER BY item.added_at DESC, item.id DESC
                """,
                [user_id, normalized_ids],
            )
            rows = cur.fetchall()

    mapping: dict[str, list[str]] = {}
    for row in rows:
        image_id = str(row.get("image_id") or "").strip()
        collection_id = str(row.get("collection_id") or "").strip()
        if not image_id or not collection_id:
            continue
        if image_id not in mapping:
            mapping[image_id] = []
        if collection_id not in mapping[image_id]:
            mapping[image_id].append(collection_id)
    return mapping


def sync_collection_summary(collection_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                WITH latest_item AS (
                    SELECT image_id, image_url
                    FROM favorite_collection_items
                    WHERE collection_id = %s
                    ORDER BY added_at DESC, id DESC
                    LIMIT 1
                ),
                item_stats AS (
                    SELECT COUNT(*)::int AS item_count
                    FROM favorite_collection_items
                    WHERE collection_id = %s
                )
                UPDATE favorite_collections AS collection
                SET item_count = item_stats.item_count,
                    cover_image_id = latest_item.image_id,
                    cover_image_url = latest_item.image_url,
                    updated_at = NOW()
                FROM item_stats
                LEFT JOIN latest_item ON TRUE
                WHERE collection.id = %s
                RETURNING {_qualified_collection_columns("collection")}
                """,
                [collection_id, collection_id, collection_id],
            )
            row = cur.fetchone()
            conn.commit()
    return _serialize_collection(dict(row)) if row else None


def update_collection_profile(
    collection_id: str,
    *,
    profile_status: str,
    profile_vector: list[float] | None,
    profile_vector_type: str,
) -> dict[str, Any] | None:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE favorite_collections
                SET profile_status = %s,
                    profile_vector = %s,
                    profile_vector_type = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING {_COLLECTION_COLUMNS}
                """,
                [
                    profile_status,
                    Jsonb(profile_vector) if profile_vector is not None else None,
                    profile_vector_type,
                    collection_id,
                ],
            )
            row = cur.fetchone()
            conn.commit()
    return _serialize_collection(dict(row)) if row else None
