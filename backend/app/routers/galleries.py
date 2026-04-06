"""
Gallery Router — Read-only endpoints for the frontend to display galleries.

Write operations are handled by the inspiration-gallery-mcp service.
"""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..dependencies import require_role
from ..models import AuthenticatedUser
from ..postgres import pg_connection
from ..services.oss_service import get_oss_service

router = APIRouter(prefix="/galleries", tags=["galleries"])


def _serialize_gallery_public(row: dict) -> dict:
    """Return only public gallery fields for the inspiration UI.

    Keep source provenance internal so upstream data URLs are never exposed to
    the client by accident.
    """
    payload = {
        "id": row.get("id"),
        "title": row.get("title"),
        "description": row.get("description"),
        "category": row.get("category"),
        "tags": row.get("tags") or [],
        "cover_url": row.get("cover_url") or "",
        "status": row.get("status"),
        "image_count": row.get("image_count") or 0,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }

    if payload["created_at"]:
        payload["created_at"] = payload["created_at"].isoformat()
    if payload["updated_at"]:
        payload["updated_at"] = payload["updated_at"].isoformat()

    return payload


def _serialize_gallery_image_public(row: dict) -> dict:
    payload = {
        "id": row.get("id"),
        "image_url": row.get("image_url"),
        "thumbnail_url": row.get("thumbnail_url") or "",
        "caption": row.get("caption") or "",
        "sort_order": row.get("sort_order") or 0,
        "width": row.get("width"),
        "height": row.get("height"),
        "created_at": row.get("created_at"),
        "colors": row.get("colors"),
    }

    if payload["created_at"]:
        payload["created_at"] = payload["created_at"].isoformat()

    return payload


def _build_gallery_where(
    *,
    category: Optional[str],
    tag: Optional[str],
    status: Optional[str],
) -> tuple[str, list[object]]:
    conditions: list[str] = []
    params: list[object] = []

    if status:
        conditions.append("status = %s")
        params.append(status)

    if category:
        conditions.append("category = %s")
        params.append(category)

    if tag:
        # Use array containment so PostgreSQL can leverage a GIN index on tags.
        conditions.append("tags @> %s")
        params.append([tag])

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    return where_sql, params


@router.get("")
async def list_galleries(
    category: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    status: str = Query("published"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List galleries with optional filtering."""
    where_sql, params = _build_gallery_where(category=category, tag=tag, status=status)

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    id,
                    title,
                    description,
                    category,
                    tags,
                    cover_url,
                    status,
                    image_count,
                    created_at,
                    updated_at,
                    COUNT(*) OVER()::int AS total_count
                FROM galleries
                {where_sql}
                ORDER BY created_at DESC, id DESC
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            raw_rows = list(cur.fetchall())

            if raw_rows:
                total = int(raw_rows[0]["total_count"] or 0)
                rows = []
                for row in raw_rows:
                    payload = dict(row)
                    payload.pop("total_count", None)
                    rows.append(_serialize_gallery_public(payload))
            else:
                cur.execute(f"SELECT count(*)::int AS total FROM galleries {where_sql}", params)
                total = int((cur.fetchone() or {}).get("total", 0))
                rows = []

    return {
        "success": True,
        "data": {
            "galleries": rows,
            "total": total,
            "has_more": offset + len(rows) < total,
        },
    }


@router.get("/{gallery_id}")
async def get_gallery(gallery_id: str):
    """Get gallery details with images."""
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, title, description, category, tags, cover_url,
                          status, image_count, created_at, updated_at
                   FROM galleries WHERE id = %s""",
                [gallery_id],
            )
            row = cur.fetchone()
            if not row:
                return JSONResponse(
                    status_code=404,
                    content={"success": False, "error": "图集不存在"},
                )
            gallery = _serialize_gallery_public(dict(row))

            cur.execute(
                """SELECT id, image_url, thumbnail_url, caption,
                          sort_order, width, height, created_at, colors
                   FROM gallery_images
                   WHERE gallery_id = %s
                   ORDER BY sort_order, created_at""",
                [gallery_id],
            )
            images = [_serialize_gallery_image_public(dict(r)) for r in cur.fetchall()]

    gallery["images"] = []
    for img in images:
        gallery["images"].append(img)

    return {"success": True, "data": gallery}


def _calc_hsv_similarity(c_h: int, c_s: int, c_v: int, pct: float, t_h: int, t_s: int, t_v: int) -> float:
    h_dist = min(abs(c_h - t_h), 360 - abs(c_h - t_h))
    s_dist = abs(c_s - t_s)
    v_dist = abs(c_v - t_v)
    base_sim = 100 - (h_dist * 0.6 + s_dist * 0.2 + v_dist * 0.2)
    return (base_sim - 5) + (pct / 100) * 5

@router.get("/colors/search")
async def search_by_color(
    h: int = Query(..., ge=0, le=360),
    s: int = Query(..., ge=0, le=100),
    v: int = Query(..., ge=0, le=100),
    h_range: int = Query(15, ge=1, le=50),
    s_range: int = Query(20, ge=1, le=50),
    v_range: int = Query(20, ge=1, le=50),
    min_pct: float = Query(5.0, ge=0.0, le=100.0),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Search images by extracting matching HSV arrays and computing similarity."""
    
    # Calculate bounds
    h_min, h_max = h - h_range, h + h_range
    s_min, s_max = max(0, s - s_range), min(100, s + s_range)
    v_min, v_max = max(0, v - v_range), min(100, v + v_range)
    
    with pg_connection() as conn:
        with conn.cursor() as cur:
            # We use a JSONB CTE or EXISTS to find rows.
            # However, for H, we need to handle wrapping around 0/360 if h_min < 0 or h_max > 360.
            if h_min < 0 or h_max > 360:
                h_cond = "( (c->'hsv'->>'h')::int >= %s OR (c->'hsv'->>'h')::int <= %s )"
                if h_min < 0:
                    h_args = [360 + h_min, h_max]
                else:
                    h_args = [h_min, h_max - 360]
            else:
                h_cond = "( (c->'hsv'->>'h')::int BETWEEN %s AND %s )"
                h_args = [h_min, h_max]
            
            sql = f"""
                SELECT id, image_url, thumbnail_url, caption, sort_order, width, height, colors, gallery_id
                FROM gallery_images
                WHERE colors IS NOT NULL
                  AND jsonb_typeof(colors) = 'array'
                  AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(colors) as c
                    WHERE {h_cond}
                      AND (c->'hsv'->>'s')::int BETWEEN %s AND %s
                      AND (c->'hsv'->>'v')::int BETWEEN %s AND %s
                      AND (c->>'percentage')::float >= %s
                  )
            """
            params = [*h_args, s_min, s_max, v_min, v_max, min_pct]
            
            cur.execute(sql, params)
            rows = [dict(r) for r in cur.fetchall()]
            
    # Compute similarity and filter/sort in Python
    scored_results = []
    for row in rows:
        colors = row.get("colors") or []
        best_score = -1000
        best_color = None
        
        for c in colors:
            c_h = c.get("hsv", {}).get("h", 0)
            c_s = c.get("hsv", {}).get("s", 0)
            c_v = c.get("hsv", {}).get("v", 0)
            pct = c.get("percentage", 0.0)
            
            # Re-check bounds (especially important if wrapping was used)
            # Actually, calculate score directly and take the max
            score = _calc_hsv_similarity(c_h, c_s, c_v, pct, h, s, v)
            if score > best_score:
                best_score = score
                best_color = c
                
        if best_color:
            row["similarity_score"] = round(best_score, 2)
            row["matched_color"] = best_color
            del row["colors"] # Omit full color array to save bandwidth
            scored_results.append(row)
            
    # Sort by descending score
    scored_results.sort(key=lambda x: x["similarity_score"], reverse=True)
    
    # Pagination
    total = len(scored_results)
    paginated = scored_results[offset : offset + limit]
    
    return {
        "success": True,
        "data": {
            "images": paginated,
            "total": total,
            "has_more": offset + len(paginated) < total
        }
    }


@router.delete("/{gallery_id}")
async def delete_gallery(
    gallery_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    """Delete a gallery and all its images from DB and OSS."""
    # 1. Delete from DB (cascades to gallery_images)
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM galleries WHERE id = %s", [gallery_id])
            deleted_rows = cur.rowcount
            if deleted_rows == 0:
                return JSONResponse(
                    status_code=404,
                    content={"success": False, "error": "图集不存在"},
                )
        conn.commit()

    # 2. Cleanup OSS images
    # The gallery MCP uploads to `gallery/{gallery_id}/...`
    oss = get_oss_service()
    oss.delete_prefix(f"gallery/{gallery_id}/")

    return {"success": True, "message": "图集已删除"}
