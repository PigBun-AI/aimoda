"""
Gallery Router — Read-only endpoints for the frontend to display galleries.

Write operations are handled by the inspiration-gallery-mcp service.
"""

import math
from typing import Annotated, Optional

import psycopg
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import JSONResponse

from ..config import settings
from ..dependencies import require_role
from ..models import AuthenticatedUser
from ..services.oss_service import get_oss_service

router = APIRouter(prefix="/galleries", tags=["galleries"])


def _get_pg():
    return psycopg.connect(settings.POSTGRES_DSN)


@router.get("")
async def list_galleries(
    category: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    status: str = Query("published"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List galleries with optional filtering."""
    conditions = []
    params: list = []

    if status:
        conditions.append(f"status = %s")
        params.append(status)

    if category:
        conditions.append(f"category = %s")
        params.append(category)

    if tag:
        conditions.append(f"%s = ANY(tags)")
        params.append(tag)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with _get_pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT count(*)::int FROM galleries {where}", params
            )
            total = cur.fetchone()[0]

            cur.execute(
                f"""SELECT id, title, description, category, tags, cover_url,
                           source, status, image_count, created_at, updated_at
                    FROM galleries {where}
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s""",
                params + [limit, offset],
            )
            columns = [desc[0] for desc in cur.description]
            rows = [dict(zip(columns, row)) for row in cur.fetchall()]

    for g in rows:
        if g.get("created_at"):
            g["created_at"] = g["created_at"].isoformat()
        if g.get("updated_at"):
            g["updated_at"] = g["updated_at"].isoformat()

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
    with _get_pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, title, description, category, tags, cover_url,
                          source, status, image_count, created_at, updated_at
                   FROM galleries WHERE id = %s""",
                [gallery_id],
            )
            row = cur.fetchone()
            if not row:
                return JSONResponse(
                    status_code=404,
                    content={"success": False, "error": "图集不存在"},
                )
            columns = [desc[0] for desc in cur.description]
            gallery = dict(zip(columns, row))

            cur.execute(
                """SELECT id, image_url, thumbnail_url, caption,
                          sort_order, width, height, created_at, colors
                   FROM gallery_images
                   WHERE gallery_id = %s
                   ORDER BY sort_order, created_at""",
                [gallery_id],
            )
            img_columns = [desc[0] for desc in cur.description]
            images = [dict(zip(img_columns, r)) for r in cur.fetchall()]

    if gallery.get("created_at"):
        gallery["created_at"] = gallery["created_at"].isoformat()
    if gallery.get("updated_at"):
        gallery["updated_at"] = gallery["updated_at"].isoformat()

    gallery["images"] = []
    for img in images:
        if img.get("created_at"):
            img["created_at"] = img["created_at"].isoformat()
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
    
    with _get_pg() as conn:
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
            columns = [desc[0] for desc in cur.description]
            rows = [dict(zip(columns, r)) for r in cur.fetchall()]
            
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
    with _get_pg() as conn:
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

