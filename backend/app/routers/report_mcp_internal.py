import logging
import math
import tempfile
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile

from ..config import settings
from ..dependencies import require_report_mcp_internal_service
from ..repositories.report_repo import find_report_by_slug
from ..services.report_service import get_report_spec, get_reports, upload_report_archive

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


@router.get("/spec")
def report_spec(
    service_name: Annotated[str, Depends(require_report_mcp_internal_service)],
):
    logger.info("report-mcp internal spec requested by %s", service_name)
    return {"success": True, "spec": get_report_spec()}


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
