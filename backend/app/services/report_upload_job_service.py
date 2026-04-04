"""
Async report upload job service.
"""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..config import settings
from ..models import ReportUploadJobRecord
from ..repositories.report_upload_job_repo import (
    create_upload_job,
    fail_incomplete_upload_jobs,
    get_upload_job,
    mark_upload_job_completed,
    mark_upload_job_failed,
    mark_upload_job_processing,
)
from .oss_service import get_oss_service, OSSService
from .report_service import upload_report_archive

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="report-upload")


def _job_archive_path(job_id: str) -> Path:
    base_dir = settings.resolved_upload_tmp_dir / "report-upload-jobs"
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir / f"{job_id}.zip"


def recover_report_upload_jobs() -> int:
    return fail_incomplete_upload_jobs("任务在服务重启期间中断，请重新上传。")


def get_report_upload_job(job_id: str) -> ReportUploadJobRecord | None:
    return get_upload_job(job_id)


def enqueue_report_upload_job(*, filename: str, file_bytes: bytes, uploaded_by: int) -> ReportUploadJobRecord:
    job_id = str(uuid.uuid4())
    archive_path = _job_archive_path(job_id)
    archive_path.write_bytes(file_bytes)

    job = create_upload_job(
        job_id=job_id,
        filename=filename,
        uploaded_by=uploaded_by,
        file_size_bytes=len(file_bytes),
        source_object_key=None,
    )

    _executor.submit(_process_report_upload_job, job.id, archive_path, uploaded_by)
    logger.info("Queued report upload job %s for %s (%d bytes)", job.id, filename, len(file_bytes))
    return job


def prepare_direct_upload_job(
    *,
    filename: str,
    file_size_bytes: int,
    uploaded_by: int,
    content_type: str = "application/zip",
    expires_seconds: int = 900,
) -> dict:
    job_id = str(uuid.uuid4())
    oss = get_oss_service()
    source_object_key = OSSService.report_upload_staging_path(job_id, filename)
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


def complete_direct_upload_job(*, job_id: str, uploaded_by: int) -> ReportUploadJobRecord:
    job = get_upload_job(job_id)
    if not job:
        raise ValueError("Upload job not found")
    if job.uploaded_by != uploaded_by:
        raise PermissionError("Upload job does not belong to caller")
    if not job.source_object_key:
        raise ValueError("Upload job is missing source object key")
    if job.status == "completed":
        return job
    if job.status == "processing":
        return job

    oss = get_oss_service()
    if not oss.exists(job.source_object_key):
        raise FileNotFoundError("Upload object not found in OSS")

    marked_job = mark_upload_job_processing(job.id)
    _executor.submit(_process_report_upload_job_from_oss, job.id, job.source_object_key, uploaded_by)
    logger.info("Queued direct OSS report upload job %s from %s", job.id, job.source_object_key)
    return marked_job or get_upload_job(job.id) or job


def _process_report_upload_job(job_id: str, archive_path: Path, uploaded_by: int) -> None:
    mark_upload_job_processing(job_id)
    try:
        report = upload_report_archive(str(archive_path), uploaded_by=uploaded_by)
        mark_upload_job_completed(job_id, report.id, report.slug)
        logger.info("Completed report upload job %s -> report %s", job_id, report.slug)
    except Exception as exc:
        logger.exception("Report upload job %s failed: %s", job_id, exc)
        mark_upload_job_failed(job_id, str(exc))
        archive_path.unlink(missing_ok=True)


def _process_report_upload_job_from_oss(job_id: str, source_object_key: str, uploaded_by: int) -> None:
    archive_path = _job_archive_path(job_id)
    oss = get_oss_service()
    try:
        oss.download_file_to_path(source_object_key, str(archive_path))
        report = upload_report_archive(str(archive_path), uploaded_by=uploaded_by)
        mark_upload_job_completed(job_id, report.id, report.slug)
        logger.info("Completed direct OSS report upload job %s -> report %s", job_id, report.slug)
        try:
            oss.delete_file(source_object_key)
        except Exception as cleanup_exc:
            logger.warning("Failed to delete staged OSS object %s: %s", source_object_key, cleanup_exc)
    except Exception as exc:
        logger.exception("Direct OSS report upload job %s failed: %s", job_id, exc)
        mark_upload_job_failed(job_id, str(exc))
        archive_path.unlink(missing_ok=True)
