from __future__ import annotations

import logging
import math
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..config import settings
from ..dependencies import require_trend_flow_mcp_internal_service
from ..repositories.trend_flow_repo import find_trend_flow_by_slug
from ..services.report_package_errors import build_report_error, parse_report_error
from ..services.trend_flow_service import (
    get_trend_flow_spec,
    get_trend_flow_template,
    get_trend_flows,
)
from ..services.trend_flow_upload_job_service import (
    complete_direct_trend_flow_upload_job,
    get_trend_flow_upload_job,
    prepare_direct_trend_flow_upload_job,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/trend-flow-mcp",
    tags=["trend-flow-mcp-internal"],
    include_in_schema=False,
)


def _serialize_trend_flow(item) -> dict:
    return item.model_dump(by_alias=True)


def _serialize_upload_job(job) -> dict:
    return job.model_dump(by_alias=True)


def _next_action(action_type: str, **payload) -> dict:
    return {"type": action_type, **payload}


def _job_next_action(job) -> dict:
    if job.status == "pending":
        return _next_action("complete_trend_flow_upload", job_id=job.id)
    if job.status == "processing":
        return _next_action("poll_trend_flow_upload_status", job_id=job.id, delay_seconds=2)
    if job.status == "completed":
        return _next_action("done", job_id=job.id, trend_flow_slug=job.trend_flow_slug)
    return _next_action("fix_trend_flow_package_and_retry", job_id=job.id)


def _serialize_job_error(job) -> dict | None:
    if job.status != "failed":
        return None
    return parse_report_error(job.error_message) or build_report_error("trend_flow_upload_failed", "趋势流动处理失败")


class PrepareTrendFlowUploadRequest(BaseModel):
    filename: str = Field(min_length=1)
    file_size_bytes: int = Field(ge=1)
    content_type: str = "application/zip"


class CompleteTrendFlowUploadRequest(BaseModel):
    job_id: str = Field(min_length=1)
    object_key: str | None = None


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


@router.post("/upload/prepare", status_code=201)
def prepare_trend_flow_upload_for_mcp(
    body: PrepareTrendFlowUploadRequest,
    service_name: Annotated[str, Depends(require_trend_flow_mcp_internal_service)],
):
    start = perf_counter()
    prepared = prepare_direct_trend_flow_upload_job(
        filename=body.filename,
        file_size_bytes=body.file_size_bytes,
        uploaded_by=settings.TREND_FLOW_MCP_SERVICE_USER_ID,
        content_type=body.content_type,
    )
    job = prepared["job"]
    upload = prepared["upload"]
    logger.info(
        "trend-flow-mcp prepare upload by %s job=%s file=%s size_bytes=%s duration_ms=%.1f",
        service_name,
        job.id,
        body.filename,
        body.file_size_bytes,
        (perf_counter() - start) * 1000,
    )
    return {
        "success": True,
        "message": "已创建趋势流动直传 OSS 上传任务",
        "job": _serialize_upload_job(job),
        "upload": {
            "method": upload["method"],
            "url": upload["url"],
            "headers": upload["headers"],
            "objectKey": upload["object_key"],
            "contentType": upload["content_type"],
            "expiresAt": upload["expires_at"],
        },
        "next_action": _next_action(
            "upload_zip_to_oss",
            method=upload["method"],
            url=upload["url"],
            headers=upload["headers"],
            object_key=upload["object_key"],
            job_id=job.id,
        ),
    }


@router.post("/upload/complete", status_code=202)
def complete_trend_flow_upload_for_mcp(
    body: CompleteTrendFlowUploadRequest,
    service_name: Annotated[str, Depends(require_trend_flow_mcp_internal_service)],
):
    start = perf_counter()
    job = get_trend_flow_upload_job(body.job_id)
    if not job:
        return {
            "success": False,
            "error": build_report_error("upload_job_not_found", "未找到对应趋势流动上传任务"),
            "next_action": _next_action("prepare_trend_flow_upload"),
        }
    if body.object_key and job.source_object_key and body.object_key != job.source_object_key:
        return {
            "success": False,
            "error": build_report_error("upload_object_key_mismatch", "上传对象 key 与任务不匹配"),
            "next_action": _next_action("prepare_trend_flow_upload"),
        }

    try:
        refreshed = complete_direct_trend_flow_upload_job(
            job_id=body.job_id,
            uploaded_by=settings.TREND_FLOW_MCP_SERVICE_USER_ID,
        )
    except FileNotFoundError:
        return {
            "success": False,
            "error": build_report_error("upload_object_not_found", "OSS 中尚未找到已上传的 ZIP，请先完成直传再调用 complete。"),
            "next_action": _next_action("upload_zip_to_oss", job_id=body.job_id),
        }
    except (ValueError, PermissionError) as exc:
        return {
            "success": False,
            "error": build_report_error("complete_upload_failed", str(exc)),
            "next_action": _next_action("prepare_trend_flow_upload"),
        }

    logger.info(
        "trend-flow-mcp complete upload by %s job=%s status=%s duration_ms=%.1f",
        service_name,
        body.job_id,
        refreshed.status,
        (perf_counter() - start) * 1000,
    )
    return {
        "success": True,
        "message": "趋势流动处理任务已启动",
        "job": _serialize_upload_job(refreshed),
        "next_action": _job_next_action(refreshed),
    }


@router.get("/upload-jobs/{job_id}")
def get_trend_flow_upload_job_for_mcp(
    job_id: str,
    service_name: Annotated[str, Depends(require_trend_flow_mcp_internal_service)],
):
    start = perf_counter()
    job = get_trend_flow_upload_job(job_id)
    if not job:
        return {
            "success": False,
            "error": build_report_error("upload_job_not_found", "未找到对应趋势流动上传任务"),
            "next_action": _next_action("prepare_trend_flow_upload"),
        }
    logger.info(
        "trend-flow-mcp get upload job by %s job=%s status=%s duration_ms=%.1f",
        service_name,
        job_id,
        job.status,
        (perf_counter() - start) * 1000,
    )
    return {
        "success": True,
        "job": _serialize_upload_job(job),
        "error": _serialize_job_error(job),
        "next_action": _job_next_action(job),
    }
