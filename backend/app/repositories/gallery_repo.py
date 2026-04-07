from __future__ import annotations

from typing import Any

from ..postgres import pg_connection

_GALLERY_COLUMNS = """
    id,
    title,
    description,
    category,
    tags,
    cover_url,
    status,
    image_count,
    created_at,
    updated_at
"""


def _serialize_gallery(row: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "id": row.get("id"),
        "title": row.get("title"),
        "description": row.get("description") or "",
        "category": row.get("category") or "",
        "tags": row.get("tags") or [],
        "cover_url": row.get("cover_url") or "",
        "status": row.get("status") or "published",
        "image_count": row.get("image_count") or 0,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }

    if payload["created_at"]:
        payload["created_at"] = payload["created_at"].isoformat()
    if payload["updated_at"]:
        payload["updated_at"] = payload["updated_at"].isoformat()

    return payload


def list_galleries_admin(
    *,
    page: int = 1,
    limit: int = 20,
    q: str | None = None,
    status: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    offset = (page - 1) * limit
    conditions: list[str] = []
    params: list[object] = []

    if status and status.strip() and status != "all":
        conditions.append("status = %s")
        params.append(status.strip())

    if q and q.strip():
        keyword = f"%{q.strip()}%"
        conditions.append(
            """
            (
                title ILIKE %s
                OR COALESCE(description, '') ILIKE %s
                OR category ILIKE %s
                OR array_to_string(tags, ' ') ILIKE %s
            )
            """
        )
        params.extend([keyword, keyword, keyword, keyword])

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*)::int AS total FROM galleries {where_sql}",
                params,
            )
            total = int((cur.fetchone() or {}).get("total", 0))
            cur.execute(
                f"""
                SELECT {_GALLERY_COLUMNS}
                FROM galleries
                {where_sql}
                ORDER BY updated_at DESC, created_at DESC, id DESC
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            rows = [_serialize_gallery(dict(row)) for row in cur.fetchall()]

    return rows, total


def update_gallery_admin_fields(
    gallery_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    category: str | None = None,
    tags: list[str] | None = None,
    cover_url: str | None = None,
    status: str | None = None,
) -> dict[str, Any] | None:
    assignments: list[str] = []
    params: list[object] = []

    if title is not None:
        assignments.append("title = %s")
        params.append(title)
    if description is not None:
        assignments.append("description = %s")
        params.append(description)
    if category is not None:
        assignments.append("category = %s")
        params.append(category)
    if tags is not None:
        assignments.append("tags = %s")
        params.append(tags)
    if cover_url is not None:
        assignments.append("cover_url = %s")
        params.append(cover_url or None)
    if status is not None:
        assignments.append("status = %s")
        params.append(status)

    if not assignments:
        with pg_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT {_GALLERY_COLUMNS} FROM galleries WHERE id = %s", [gallery_id])
                row = cur.fetchone()
        return _serialize_gallery(dict(row)) if row else None

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE galleries
                SET {", ".join(assignments)},
                    updated_at = NOW()
                WHERE id = %s
                RETURNING {_GALLERY_COLUMNS}
                """,
                params + [gallery_id],
            )
            row = cur.fetchone()
            conn.commit()

    return _serialize_gallery(dict(row)) if row else None
