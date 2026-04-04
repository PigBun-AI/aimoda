"""
Async report upload job service.
"""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
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
    )

    _executor.submit(_process_report_upload_job, job.id, archive_path, uploaded_by)
    logger.info("Queued report upload job %s for %s (%d bytes)", job.id, filename, len(file_bytes))
    return job


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
