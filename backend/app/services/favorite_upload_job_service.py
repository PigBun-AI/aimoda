from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import PurePosixPath
from typing import Any

from ..agent.qdrant_utils import encode_image
from ..config import settings
from ..repositories import favorite_repo
from ..repositories import favorite_upload_job_repo
from .favorite_service import (
    ALLOWED_UPLOAD_CONTENT_TYPES,
    DEFAULT_TASTE_VECTOR_TYPE,
    MAX_UPLOAD_SIZE_BYTES,
    _normalize_vector,
    rebuild_collection_profile,
)
from .oss_service import get_oss_service

logger = logging.getLogger(__name__)

MAX_UPLOAD_BATCH_FILES = 40
_UPLOAD_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix='favorite-upload')
_ACTIVE_JOB_STATUSES = {'pending', 'uploading', 'queued', 'processing'}
_TERMINAL_JOB_STATUSES = {'completed', 'partial_failed', 'failed'}
_STALE_JOB_REASON = '上传任务已超时，请重新上传。'


def _validate_prepare_files(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not files:
        raise ValueError('No files selected')
    if len(files) > MAX_UPLOAD_BATCH_FILES:
        raise ValueError(f'At most {MAX_UPLOAD_BATCH_FILES} images can be uploaded in one batch')

    normalized: list[dict[str, Any]] = []
    for file in files:
        filename = PurePosixPath(str(file.get('filename') or 'reference-image')).name or 'reference-image'
        content_type = str(file.get('content_type') or '').split(';', 1)[0].strip().lower()
        file_size_bytes = int(file.get('file_size_bytes') or 0)

        if content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
            raise ValueError(f'Unsupported image format for {filename}')
        if file_size_bytes <= 0:
            raise ValueError(f'Invalid file size for {filename}')
        if file_size_bytes > MAX_UPLOAD_SIZE_BYTES:
            raise ValueError(f'{filename} exceeds 10MB limit')

        normalized.append({
            'filename': filename,
            'content_type': content_type,
            'file_size_bytes': file_size_bytes,
        })
    return normalized


def _attach_signed_uploads(job: dict[str, Any], user_id: int, collection_id: str) -> dict[str, Any]:
    oss = get_oss_service()
    items_with_upload: list[dict[str, Any]] = []
    for item in job.get('items', []):
        signed_url, upload_headers = oss.get_signed_upload_url(
            item['object_key'],
            content_type=item['content_type'],
        )
        items_with_upload.append({
            **item,
            'upload': {
                'method': 'PUT',
                'url': signed_url,
                'headers': upload_headers,
                'object_key': item['object_key'],
                'content_type': item['content_type'],
            },
        })
    return {**job, 'collection_id': collection_id, 'user_id': user_id, 'items': items_with_upload}


def recover_favorite_upload_jobs() -> int:
    stale_jobs = favorite_upload_job_repo.fail_stale_upload_jobs(
        '任务在服务重启期间中断，请重新上传。',
        0,
    )
    _cleanup_unfinished_upload_objects(stale_jobs)
    return len(stale_jobs)


def _cleanup_unfinished_upload_objects(jobs: list[dict[str, Any]]) -> None:
    if not jobs:
        return

    oss = get_oss_service()
    deleted_paths: set[str] = set()
    for job in jobs:
        for item in job.get('items', []):
            object_key = str(item.get('object_key') or '').strip()
            if not object_key or object_key in deleted_paths:
                continue
            if item.get('favorite_item_image_id'):
                continue
            if item.get('status') == 'completed':
                continue
            try:
                oss.delete_file(object_key)
                deleted_paths.add(object_key)
            except Exception:
                logger.debug('Failed to delete stale favorite upload object %s', object_key, exc_info=True)


def _expire_stale_upload_jobs(*, user_id: int | None = None, collection_id: str | None = None, job_id: str | None = None) -> int:
    stale_jobs = favorite_upload_job_repo.fail_stale_upload_jobs(
        _STALE_JOB_REASON,
        settings.FAVORITE_UPLOAD_JOB_STALE_SECONDS,
        user_id=user_id,
        collection_id=collection_id,
        job_id=job_id,
    )
    _cleanup_unfinished_upload_objects(stale_jobs)
    return len(stale_jobs)


def get_upload_job(user_id: int, job_id: str) -> dict[str, Any] | None:
    _expire_stale_upload_jobs(user_id=user_id, job_id=job_id)
    return favorite_upload_job_repo.get_upload_job(user_id, job_id)


def get_active_upload_job(user_id: int, collection_id: str) -> dict[str, Any] | None:
    _expire_stale_upload_jobs(user_id=user_id, collection_id=collection_id)
    return favorite_upload_job_repo.get_active_upload_job(user_id, collection_id)


def prepare_upload_job(user_id: int, collection_id: str, files: list[dict[str, Any]]) -> dict[str, Any]:
    collection = favorite_repo.get_collection(user_id, collection_id)
    if not collection:
        raise ValueError('Collection not found')

    _expire_stale_upload_jobs(user_id=user_id, collection_id=collection_id)
    active_job = favorite_upload_job_repo.get_active_upload_job(user_id, collection_id)
    if active_job:
        raise ValueError('Current collection already has an in-progress upload batch')

    normalized_files = _validate_prepare_files(files)
    oss = get_oss_service()
    job_files: list[dict[str, Any]] = []
    for file in normalized_files:
        object_key = oss.collection_upload_path(
            user_id=user_id,
            collection_id=collection_id,
            filename=file['filename'],
            content_type=file['content_type'],
        )
        job_files.append({**file, 'object_key': object_key})

    job = favorite_upload_job_repo.create_upload_job(user_id, collection_id, job_files)
    return _attach_signed_uploads(job, user_id, collection_id)


def mark_upload_item_uploaded(user_id: int, job_id: str, item_id: str, object_key: str | None = None) -> dict[str, Any] | None:
    job = favorite_upload_job_repo.get_upload_job(user_id, job_id)
    if not job:
        return None
    item = next((entry for entry in job.get('items', []) if entry['id'] == item_id), None)
    if not item:
        return None
    if object_key and object_key != item.get('object_key'):
        raise ValueError('Upload object key mismatch')
    if job['status'] in _TERMINAL_JOB_STATUSES:
        return job
    return favorite_upload_job_repo.mark_upload_item_uploaded(user_id, job_id, item_id)


def mark_upload_item_failed(user_id: int, job_id: str, item_id: str, error_message: str) -> dict[str, Any] | None:
    job = favorite_upload_job_repo.get_upload_job(user_id, job_id)
    if not job:
        return None
    if job['status'] in _TERMINAL_JOB_STATUSES:
        return job
    return favorite_upload_job_repo.mark_upload_item_failed(user_id, job_id, item_id, error_message)


def complete_upload_job(user_id: int, job_id: str) -> dict[str, Any] | None:
    _expire_stale_upload_jobs(user_id=user_id, job_id=job_id)
    job = favorite_upload_job_repo.get_upload_job(user_id, job_id)
    if not job:
        return None
    if job['status'] in _TERMINAL_JOB_STATUSES:
        return job
    if job['status'] in {'queued', 'processing'}:
        return job
    if job.get('pending_count', 0) > 0:
        raise ValueError('Some files are still waiting for upload completion')
    if job.get('uploaded_count', 0) <= 0:
        return favorite_upload_job_repo.mark_upload_job_terminal(
            job_id,
            'failed',
            job.get('error_message') or 'No successfully uploaded images were available for processing.',
        )

    queued = favorite_upload_job_repo.mark_upload_job_queued(user_id, job_id)
    _UPLOAD_EXECUTOR.submit(_process_upload_job, job_id)
    return queued


def _finalize_job_status(job_id: str) -> dict[str, Any] | None:
    job = favorite_upload_job_repo.get_upload_job_for_processing(job_id)
    if not job:
        return None

    completed_count = job.get('completed_count', 0)
    failed_count = job.get('failed_count', 0)
    total_count = job.get('total_count', 0)

    if completed_count == total_count and failed_count == 0:
        return favorite_upload_job_repo.mark_upload_job_terminal(job_id, 'completed', None)
    if completed_count > 0:
        return favorite_upload_job_repo.mark_upload_job_terminal(
            job_id,
            'partial_failed',
            f'{failed_count} files failed during upload or processing.' if failed_count else None,
        )
    return favorite_upload_job_repo.mark_upload_job_terminal(
        job_id,
        'failed',
        'No uploaded images could be processed successfully.',
    )


def _process_upload_job(job_id: str) -> None:
    job = favorite_upload_job_repo.mark_upload_job_processing(job_id)
    if not job:
        return

    collection_id = job['collection_id']
    user_id = int(job['user_id'])
    oss = get_oss_service()
    uploaded_items = favorite_upload_job_repo.list_uploaded_items(job_id)

    for item in uploaded_items:
        favorite_upload_job_repo.mark_upload_item_processing(job_id, item['id'])
        try:
            public_item_id = f"upload:{item['id']}"
            image_url = oss.get_url(item['object_key'])
            content_type = (item['content_type'] or '').split(';', 1)[0].strip().lower()
            if content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
                raise ValueError('Unsupported image format')
            embedding_vector = _normalize_vector(
                encode_image(
                    image_url=image_url,
                    media_type=content_type,
                )
            )
            inserted = favorite_repo.add_uploaded_item(
                user_id,
                collection_id,
                image_id=public_item_id,
                image_url=image_url,
                source_ref_id=item['id'],
                original_filename=item['filename'],
                mime_type=content_type,
                embedding_vector=embedding_vector,
                embedding_vector_type=DEFAULT_TASTE_VECTOR_TYPE,
                storage_path=item['object_key'],
            )
            if not inserted:
                raise RuntimeError('Failed to persist uploaded collection item')
            favorite_upload_job_repo.mark_upload_item_completed(job_id, item['id'], public_item_id)
        except Exception as exc:
            logger.exception('Favorite upload item %s failed: %s', item['id'], exc)
            favorite_upload_job_repo.mark_upload_item_processing_failed(job_id, item['id'], str(exc))
            object_key = str(item.get('object_key') or '').strip()
            if object_key:
                try:
                    oss.delete_file(object_key)
                except Exception:
                    logger.debug('Failed to delete orphaned favorite upload object %s', object_key, exc_info=True)

    refreshed = favorite_upload_job_repo.get_upload_job_for_processing(job_id)
    if refreshed and refreshed.get('completed_count', 0) > 0:
        favorite_repo.sync_collection_summary(collection_id)
        rebuild_collection_profile(collection_id)

    _finalize_job_status(job_id)
