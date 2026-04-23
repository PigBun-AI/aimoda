from __future__ import annotations

import logging
import math
import tempfile
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile

from ..config import settings
from ..dependencies import require_trend_flow_mcp_internal_service
from ..repositories.trend_flow_repo import find_trend_flow_by_slug
from ..services.trend_flow_service import (
    get_trend_flow_spec,
    get_trend_flow_template,
    get_trend_flows,
    upload_trend_flow_archive,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/trend-flow-mcp",
    tags=["trend-flow-mcp-internal"],
    include_in_schema=False,
)


def _serialize_trend_flow(item) -> dict:
    return item.model_dump(by_alias=True)


@router.get("/spec")
def trend_flow_spec(
    service_name: Annotated[str, Depends(require_trend_flow_mcp_internal_service)],
):
    logger.info("trend-flow-mcp internal spec requested by %s", service_name)
    return {"success": True, "spec": get_trend_flow_spec()}


@router.get("/template")
def trend_flow_template(
    service_name: Annotated[str, Depends(require_trend_flow_mcp_internal_service)],
):
    logger.info("trend-flow-mcp internal template requested by %s", service_name)
    return {"success": True, "template": get_trend_flow_template()}


@router.get("/items")
def list_trend_flows_for_mcp(
    service_name: Annotated[str, Depends(require_trend_flow_mcp_internal_service)],
    slug: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
):
    start = perf_counter()
    if slug:
        item = find_trend_flow_by_slug(slug)
        return {
            "success": True,
            "found": item is not None,
            "trend_flow": _serialize_trend_flow(item) if item else None,
            "slug": slug,
        }

    items, total = get_trend_flows(page=page, limit=limit, q=q)
    logger.info(
        "trend-flow-mcp list by %s page=%s limit=%s returned=%s duration_ms=%.1f",
        service_name,
        page,
        limit,
        len(items),
        (perf_counter() - start) * 1000,
    )
    return {
        "success": True,
        "trend_flows": [_serialize_trend_flow(item) for item in items],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.post("/upload", status_code=201)
async def upload_trend_flow_for_mcp(
    service_name: Annotated[str, Depends(require_trend_flow_mcp_internal_service)],
    file: UploadFile = File(...),
):
    if not file.filename:
        return {"success": False, "error": "未提供上传文件"}

    start = perf_counter()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    trend_flow = upload_trend_flow_archive(
        archive_path=tmp_path,
        uploaded_by=settings.TREND_FLOW_MCP_SERVICE_USER_ID,
    )
    logger.info(
        "trend-flow-mcp upload by %s file=%s size_bytes=%s slug=%s duration_ms=%.1f",
        service_name,
        file.filename,
        len(content),
        trend_flow.slug,
        (perf_counter() - start) * 1000,
    )
    return {
        "success": True,
        "message": "趋势流动上传成功",
        "trend_flow": {
            "id": trend_flow.id,
            "slug": trend_flow.slug,
            "title": trend_flow.title,
            "brand": trend_flow.brand,
            "startQuarter": trend_flow.start_quarter,
            "startYear": trend_flow.start_year,
            "endQuarter": trend_flow.end_quarter,
            "endYear": trend_flow.end_year,
            "indexUrl": trend_flow.index_url,
            "coverUrl": trend_flow.cover_url,
        },
    }
