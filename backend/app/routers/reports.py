import math
import tempfile
from typing import Annotated

from fastapi import APIRouter, Depends, UploadFile, File, Query

from ..dependencies import get_current_user, require_role, check_report_view_permission_dep
from ..models import AuthenticatedUser
from ..services.report_service import (
    get_report,
    get_reports,
    get_report_spec,
    upload_report_archive,
    delete_report_with_files,
)
from ..services.report_view_service import get_view_status
from ..repositories.activity_repo import log_activity

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("")
def list_reports(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=12, ge=1, le=100),
):
    reports, total = get_reports(page, limit)
    return {
        "success": True,
        "data": [r.model_dump(by_alias=True) for r in reports],
        "meta": {
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/view-status")
def view_status(user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
    status = get_view_status(user.id, user.role)
    return {"success": True, "data": status}


@router.get("/spec")
def report_spec():
    return {"success": True, "data": get_report_spec()}


@router.get("/{report_id}")
def get_single_report(
    report_id: int,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    # Check view permission (records view if applicable)
    check_report_view_permission_dep(report_id, user)

    report = get_report(report_id)
    if not report:
        return {"success": False, "error": "未找到对应报告"}

    log_activity(user.id, "view_report")

    view_stat = get_view_status(user.id, user.role)

    return {
        "success": True,
        "data": report.model_dump(by_alias=True),
        "meta": {"viewStatus": view_stat},
    }


@router.post("/upload", status_code=201)
async def upload_report(
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin", "editor"]))],
    file: UploadFile = File(...),
):
    if not file.filename:
        return {"success": False, "error": "未提供上传文件"}

    # Save uploaded file to temp location
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    report = upload_report_archive(archive_path=tmp_path, uploaded_by=user.id)

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


@router.delete("/{report_id}")
def delete_report(
    report_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    deleted = delete_report_with_files(report_id)
    if not deleted:
        return {"success": False, "error": "未找到对应报告"}
    return {"success": True, "message": "报告删除成功"}
