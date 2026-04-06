import logging
import math
import tempfile
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field

from ..config import settings
from ..dependencies import require_report_mcp_internal_service
from ..repositories.report_repo import find_report_by_slug
from ..services.report_package_errors import build_report_error, parse_report_error
from ..services.report_service import (
    get_openclaw_report_template,
    get_openclaw_upload_contract,
    get_report_spec,
    get_reports,
    upload_report_archive,
)
from ..services.report_upload_job_service import (
    prepare_direct_upload_job,
    complete_direct_upload_job,
    get_report_upload_job,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/report-mcp",
    tags=["report-mcp-internal"],
    include_in_schema=False,
)


def _serialize_report(report) -> dict:
    return {
        "id": report.id,
        "slug": report.slug,
        "title": report.title,
        "brand": report.brand,
        "season": report.season,
        "year": report.year,
        "lookCount": report.look_count,
        "indexUrl": report.index_url,
        "overviewUrl": report.overview_url,
        "coverUrl": report.cover_url,
        "createdAt": report.created_at,
        "updatedAt": report.updated_at,
    }


def _serialize_upload_job(job) -> dict:
    return job.model_dump(by_alias=True)


def _next_action(action_type: str, **payload) -> dict:
    return {"type": action_type, **payload}


def _job_next_action(job) -> dict:
    if job.status == "pending":
        return _next_action("complete_report_upload", job_id=job.id)
    if job.status == "processing":
        return _next_action("poll_report_upload_status", job_id=job.id, delay_seconds=2)
    if job.status == "completed":
        return _next_action("done", job_id=job.id, report_slug=job.report_slug)
    return _next_action("fix_report_package_and_retry", job_id=job.id)


def _serialize_job_error(job) -> dict | None:
    if job.status != "failed":
        return None
    return parse_report_error(job.error_message) or build_report_error("report_upload_failed", "报告处理失败")


class PrepareReportUploadRequest(BaseModel):
    filename: str = Field(min_length=1)
    file_size_bytes: int = Field(ge=1)
    content_type: str = "application/zip"


class CompleteReportUploadRequest(BaseModel):
    job_id: str = Field(min_length=1)
    object_key: str | None = None


@router.get("/spec")
def report_spec(
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
):
    logger.info("report-mcp internal spec requested by %s", service_name)
    return {"success": True, "spec": get_report_spec()}


@router.get("/openclaw/upload-contract")
def openclaw_upload_contract(
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
):
    logger.info("report-mcp openclaw contract requested by %s", service_name)
    return {
        "success": True,
        "contract": get_openclaw_upload_contract(),
        "next_action": _next_action("prepare_report_upload"),
    }


@router.get("/openclaw/report-template")
def openclaw_report_template(
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
):
    logger.info("report-mcp openclaw template requested by %s", service_name)
    return {
        "success": True,
        "template": get_openclaw_report_template(),
        "next_action": _next_action("prepare_report_upload"),
    }


@router.get("/reports")
def list_reports_for_mcp(
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
    slug: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    start = perf_counter()
    if slug:
        report = find_report_by_slug(slug)
        payload = {
            "success": True,
            "found": report is not None,
            "report": _serialize_report(report) if report else None,
            "slug": slug,
        }
        logger.info(
            "report-mcp internal lookup by %s slug=%s found=%s duration_ms=%.1f",
            service_name,
            slug,
            report is not None,
            (perf_counter() - start) * 1000,
        )
        return payload

    reports, total = get_reports(page, limit)
    payload = {
        "success": True,
        "reports": [_serialize_report(report) for report in reports],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }
    logger.info(
        "report-mcp internal list by %s page=%s limit=%s returned=%s duration_ms=%.1f",
        service_name,
        page,
        limit,
        len(payload["reports"]),
        (perf_counter() - start) * 1000,
    )
    return payload


@router.post("/upload", status_code=201)
async def upload_report_for_mcp(
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
    file: UploadFile = File(...),
):
    if not file.filename:
        return {"success": False, "error": "未提供上传文件"}

    start = perf_counter()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    report = upload_report_archive(
        archive_path=tmp_path,
        uploaded_by=settings.REPORT_MCP_SERVICE_USER_ID,
    )

    logger.info(
        "report-mcp internal upload by %s file=%s size_bytes=%s slug=%s duration_ms=%.1f",
        service_name,
        file.filename,
        len(content),
        report.slug,
        (perf_counter() - start) * 1000,
    )

    return {
        "success": True,
        "message": "报告上传成功",
        "report": {
            "id": report.id,
            "slug": report.slug,
            "title": report.title,
            "brand": report.brand,
            "season": f"{report.season} {report.year}",
            "lookCount": report.look_count,
            "indexUrl": report.index_url,
            "overviewUrl": report.overview_url,
            "coverUrl": report.cover_url,
        },
    }


@router.post("/upload/prepare", status_code=201)
def prepare_report_upload_for_mcp(
    body: PrepareReportUploadRequest,
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
):
    start = perf_counter()
    prepared = prepare_direct_upload_job(
        filename=body.filename,
        file_size_bytes=body.file_size_bytes,
        uploaded_by=settings.REPORT_MCP_SERVICE_USER_ID,
        content_type=body.content_type,
    )
    job = prepared["job"]
    upload = prepared["upload"]
    logger.info(
        "report-mcp prepare upload by %s job=%s file=%s size_bytes=%s duration_ms=%.1f",
        service_name,
        job.id,
        body.filename,
        body.file_size_bytes,
        (perf_counter() - start) * 1000,
    )
    return {
        "success": True,
        "message": "已创建直传 OSS 上传任务",
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
def complete_report_upload_for_mcp(
    body: CompleteReportUploadRequest,
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
):
    start = perf_counter()
    job = get_report_upload_job(body.job_id)
    if not job:
        return {
            "success": False,
            "error": build_report_error("upload_job_not_found", "未找到对应上传任务"),
            "next_action": _next_action("prepare_report_upload"),
        }
    if body.object_key and job.source_object_key and body.object_key != job.source_object_key:
        return {
            "success": False,
            "error": build_report_error("upload_object_key_mismatch", "上传对象 key 与任务不匹配"),
            "next_action": _next_action("prepare_report_upload"),
        }

    try:
        refreshed = complete_direct_upload_job(
            job_id=body.job_id,
            uploaded_by=settings.REPORT_MCP_SERVICE_USER_ID,
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
            "next_action": _next_action("prepare_report_upload"),
        }
    logger.info(
        "report-mcp complete upload by %s job=%s status=%s duration_ms=%.1f",
        service_name,
        body.job_id,
        refreshed.status,
        (perf_counter() - start) * 1000,
    )
    return {
        "success": True,
        "message": "报告处理任务已启动",
        "job": _serialize_upload_job(refreshed),
        "next_action": _job_next_action(refreshed),
    }


@router.get("/upload-jobs/{job_id}")
def get_report_upload_job_for_mcp(
    job_id: str,
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
):
    start = perf_counter()
    job = get_report_upload_job(job_id)
    if not job:
        return {
            "success": False,
            "error": build_report_error("upload_job_not_found", "未找到对应上传任务"),
            "next_action": _next_action("prepare_report_upload"),
        }
    logger.info(
        "report-mcp get upload job by %s job=%s status=%s duration_ms=%.1f",
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
