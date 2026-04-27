"""
Async Trend Flow upload job service.
"""

from __future__ import annotations

import logging
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..config import settings
from ..exceptions import AppError
from ..models import TrendFlowUploadJobRecord
from ..repositories.trend_flow_upload_job_repo import (
    create_upload_job,
    fail_incomplete_upload_jobs,
    get_upload_job,
    mark_upload_job_completed,
    mark_upload_job_failed,
    mark_upload_job_processing,
)
from .oss_service import OSSService, get_oss_service
from .report_package_errors import ReportPackageError, build_report_error
from .trend_flow_service import upload_trend_flow_archive

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="trend-flow-upload")


def _job_archive_path(job_id: str) -> Path:
    base_dir = settings.resolved_upload_tmp_dir / "trend-flow-upload-jobs"
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir / f"{job_id}.zip"


def recover_trend_flow_upload_jobs() -> int:
    return fail_incomplete_upload_jobs("任务在服务重启期间中断，请重新上传。")


def get_trend_flow_upload_job(job_id: str) -> TrendFlowUploadJobRecord | None:
    return get_upload_job(job_id)


def prepare_direct_trend_flow_upload_job(
    *,
    filename: str,
    file_size_bytes: int,
    uploaded_by: int,
    content_type: str = "application/zip",
    expires_seconds: int = 900,
) -> dict:
    job_id = str(uuid.uuid4())
    oss = get_oss_service()
    source_object_key = OSSService.trend_flow_upload_staging_path(job_id, filename)
    upload_url, upload_headers = oss.get_signed_upload_url(
        source_object_key,
        expires_seconds=expires_seconds,
        content_type=content_type,
    )
    job = create_upload_job(
        job_id=job_id,
        filename=filename,
        uploaded_by=uploaded_by,
        file_size_bytes=file_size_bytes,
        source_object_key=source_object_key,
    )

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
    return {
        "job": job,
        "upload": {
            "method": "PUT",
            "url": upload_url,
            "headers": upload_headers,
            "object_key": source_object_key,
            "content_type": content_type,
            "expires_at": expires_at.isoformat(),
        },
    }


def complete_direct_trend_flow_upload_job(*, job_id: str, uploaded_by: int) -> TrendFlowUploadJobRecord:
    job = get_upload_job(job_id)
    if not job:
        raise ValueError("Upload job not found")
    if job.uploaded_by != uploaded_by:
        raise PermissionError("Upload job does not belong to caller")
    if not job.source_object_key:
        raise ValueError("Upload job is missing source object key")
    if job.status in {"completed", "processing"}:
        return job

    oss = get_oss_service()
    if not oss.exists(job.source_object_key):
        raise FileNotFoundError("Upload object not found in OSS")

    marked_job = mark_upload_job_processing(job.id)
    _executor.submit(_process_trend_flow_upload_job_from_oss, job.id, job.source_object_key, uploaded_by)
    logger.info("Queued direct OSS Trend Flow upload job %s from %s", job.id, job.source_object_key)
    return marked_job or get_upload_job(job.id) or job


def _serialize_trend_flow_error(exc: Exception) -> str:
    if isinstance(exc, ReportPackageError):
        payload = exc.to_dict()
    elif isinstance(exc, AppError):
        payload = build_report_error("trend_flow_upload_failed", exc.message)
    else:
        payload = build_report_error("trend_flow_upload_failed", str(exc))
    return json.dumps(payload, ensure_ascii=False)


def _process_trend_flow_upload_job_from_oss(job_id: str, source_object_key: str, uploaded_by: int) -> None:
    archive_path = _job_archive_path(job_id)
    oss = get_oss_service()
    try:
        oss.download_file_to_path(source_object_key, str(archive_path))
        trend_flow = upload_trend_flow_archive(str(archive_path), uploaded_by=uploaded_by)
        mark_upload_job_completed(job_id, trend_flow.id, trend_flow.slug)
        logger.info("Completed direct OSS Trend Flow upload job %s -> %s", job_id, trend_flow.slug)
        try:
            oss.delete_file(source_object_key)
        except Exception as cleanup_exc:
            logger.warning("Failed to delete staged Trend Flow object %s: %s", source_object_key, cleanup_exc)
    except Exception as exc:
        logger.exception("Direct OSS Trend Flow upload job %s failed: %s", job_id, exc)
        mark_upload_job_failed(job_id, _serialize_trend_flow_error(exc))
    finally:
        archive_path.unlink(missing_ok=True)
