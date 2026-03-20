"""
OSS Router — file upload, download, and delete via Aliyun OSS.

Requires JWT authentication.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse

from ..dependencies import get_current_user
from ..models import AuthenticatedUser
from ..services.oss_service import get_oss_service

router = APIRouter(prefix="/oss", tags=["oss"])

# Allowed image types for avatar upload
ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_AVATAR_SIZE_MB = 5
MAX_ARTIFACT_SIZE_MB = 50


def _validate_file_size(file: UploadFile, max_mb: int) -> None:
    """Read file bytes and raise if it exceeds max size."""
    content = file.file.read()
    file.file.seek(0)
    size_mb = len(content) / (1024 * 1024)
    if size_mb > max_mb:
        raise HTTPException(
            status_code=413,
            detail=f"文件大小超过 {max_mb}MB 限制",
        )


# ── Avatar endpoints ───────────────────────────────────────────────────────────

@router.post("/avatar")
async def upload_avatar(
    file: Annotated[UploadFile, File(description="头像图片")],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Upload user avatar to OSS."""
    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(
            status_code=400,
            detail="仅支持 JPG、PNG、WebP、GIF 格式",
        )

    _validate_file_size(file, MAX_AVATAR_SIZE_MB)

    oss = get_oss_service()
    url = oss.upload_avatar(
        user_id=user.id,
        file_content=file.file,
        filename=file.filename or "avatar",
        content_type=file.content_type,
    )

    return {"success": True, "url": url}


# ── Artifact endpoints ─────────────────────────────────────────────────────────

@router.post("/artifacts/{session_id}/{artifact_type}")
async def upload_artifact(
    session_id: str,
    artifact_type: str,
    file: Annotated[UploadFile, File(description="制品文件")],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Upload artifact file (image/report/table/code/etc.) to OSS."""
    allowed_types = {
        "image", "report", "table", "code",
        "color_analysis", "trend_chart", "collection_result", "other",
    }
    if artifact_type not in allowed_types:
        raise HTTPException(status_code=400, detail="无效的制品类型")

    _validate_file_size(file, MAX_ARTIFACT_SIZE_MB)

    oss = get_oss_service()
    url = oss.upload_artifact(
        session_id=session_id,
        artifact_type=artifact_type,
        file_content=file.file,
        filename=file.filename or f"artifact.{artifact_type}",
        content_type=file.content_type,
    )

    return {"success": True, "url": url}


@router.get("/artifacts/{session_id}/{artifact_type}/signed-url")
async def get_artifact_signed_url(
    session_id: str,
    artifact_type: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    path: Annotated[str, Query(description="OSS 对象路径 (不含 bucket 前缀)")],
    expires: Annotated[int, Query(ge=60, le=86400)] = 3600,
):
    """Generate a short-lived signed URL for a private artifact."""
    oss = get_oss_service()
    try:
        url = oss.get_signed_url(path, expires_seconds=expires)
    except Exception:
        raise HTTPException(status_code=404, detail="制品不存在")

    return {"success": True, "url": url}


@router.delete("/artifacts/{session_id}/{artifact_type}")
async def delete_artifact(
    session_id: str,
    artifact_type: str,
    path: Annotated[str, Query(description="OSS 对象路径")],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Delete an artifact file."""
    oss = get_oss_service()
    try:
        oss.delete_file(path)
    except Exception:
        pass  # idempotent delete

    return {"success": True}


@router.delete("/artifacts/{session_id}")
async def delete_session_artifacts(
    session_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Delete all artifacts for a session (recursive prefix delete)."""
    oss = get_oss_service()
    prefix = f"artifacts/{session_id}/"
    count = oss.delete_prefix(prefix)
    return {"success": True, "deleted_count": count}
