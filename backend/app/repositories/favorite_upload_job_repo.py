from __future__ import annotations

from typing import Any
from uuid import uuid4

from ..postgres import pg_connection

_JOB_COLUMNS = """
    id,
    collection_id,
    user_id,
    status,
    total_count,
    error_message,
    created_at,
    updated_at,
    started_at,
    completed_at
"""

_ITEM_COLUMNS = """
    id,
    job_id,
    collection_id,
    filename,
    content_type,
    file_size_bytes,
    object_key,
    status,
    sort_order,
    error_message,
    favorite_item_image_id,
    created_at,
    updated_at,
    started_at,
    completed_at
"""

_ACTIVE_JOB_STATUSES = ("pending", "uploading", "queued", "processing")


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _serialize_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row.get("id")),
        "job_id": str(row.get("job_id")),
        "collection_id": str(row.get("collection_id")),
        "filename": row.get("filename") or "",
        "content_type": row.get("content_type") or "application/octet-stream",
        "file_size_bytes": int(row.get("file_size_bytes") or 0),
        "object_key": row.get("object_key") or "",
        "status": row.get("status") or "pending",
        "sort_order": int(row.get("sort_order") or 0),
        "error_message": row.get("error_message"),
        "favorite_item_image_id": row.get("favorite_item_image_id"),
        "created_at": _iso(row.get("created_at")) or "",
        "updated_at": _iso(row.get("updated_at")) or "",
        "started_at": _iso(row.get("started_at")),
        "completed_at": _iso(row.get("completed_at")),
    }


def _serialize_job(row: dict[str, Any], items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    safe_items = items or []
    counts = {
        "pending_count": 0,
        "uploaded_count": 0,
        "processing_count": 0,
        "completed_count": 0,
        "failed_count": 0,
    }
    for item in safe_items:
        status = item.get("status")
        if status == "pending":
            counts["pending_count"] += 1
        elif status == "uploaded":
            counts["uploaded_count"] += 1
        elif status == "processing":
            counts["processing_count"] += 1
        elif status == "completed":
            counts["completed_count"] += 1
        elif status in {"upload_failed", "failed"}:
            counts["failed_count"] += 1

    return {
        "id": str(row.get("id")),
        "collection_id": str(row.get("collection_id")),
        "user_id": row.get("user_id"),
        "status": row.get("status") or "pending",
        "total_count": int(row.get("total_count") or 0),
        "error_message": row.get("error_message"),
        "created_at": _iso(row.get("created_at")) or "",
        "updated_at": _iso(row.get("updated_at")) or "",
        "started_at": _iso(row.get("started_at")),
        "completed_at": _iso(row.get("completed_at")),
        **counts,
        "items": safe_items,
    }


def _load_job(conn, *, job_id: str, user_id: int | None = None) -> dict[str, Any] | None:
    query = [f"SELECT {_JOB_COLUMNS} FROM favorite_collection_upload_jobs WHERE id = %s"]
    params: list[Any] = [job_id]
    if user_id is not None:
        query.append("AND user_id = %s")
        params.append(user_id)
    query.append("LIMIT 1")
    row = conn.execute("\n".join(query), params).fetchone()
    return dict(row) if row else None


def _load_job_items(conn, job_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"""
        SELECT {_ITEM_COLUMNS}
        FROM favorite_collection_upload_job_items
        WHERE job_id = %s
        ORDER BY sort_order ASC, created_at ASC, id ASC
        """,
        [job_id],
    ).fetchall()
    return [_serialize_item(dict(row)) for row in rows]


def _build_stale_job_where_clause(
    *,
    stale_seconds: int,
    user_id: int | None = None,
    collection_id: str | None = None,
    job_id: str | None = None,
) -> tuple[str, list[Any]]:
    clauses = [
        "status = ANY(%s)",
        "updated_at <= NOW() - (%s * INTERVAL '1 second')",
    ]
    params: list[Any] = [list(_ACTIVE_JOB_STATUSES), max(0, stale_seconds)]

    if user_id is not None:
        clauses.append("user_id = %s")
        params.append(user_id)
    if collection_id is not None:
        clauses.append("collection_id = %s")
        params.append(collection_id)
    if job_id is not None:
        clauses.append("id = %s")
        params.append(job_id)

    return " AND ".join(clauses), params


def create_upload_job(user_id: int, collection_id: str, files: list[dict[str, Any]]) -> dict[str, Any]:
    job_id = str(uuid4())
    item_rows: list[dict[str, Any]] = []

    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO favorite_collection_upload_jobs (id, collection_id, user_id, status, total_count)
                VALUES (%s, %s, %s, 'pending', %s)
                RETURNING {_JOB_COLUMNS}
                """,
                [job_id, collection_id, user_id, len(files)],
            )
            job_row = dict(cur.fetchone())

            for index, file in enumerate(files):
                cur.execute(
                    f"""
                    INSERT INTO favorite_collection_upload_job_items (
                        job_id,
                        collection_id,
                        filename,
                        content_type,
                        file_size_bytes,
                        object_key,
                        status,
                        sort_order
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, 'pending', %s)
                    RETURNING {_ITEM_COLUMNS}
                    """,
                    [
                        job_id,
                        collection_id,
                        file["filename"],
                        file["content_type"],
                        file["file_size_bytes"],
                        file["object_key"],
                        index,
                    ],
                )
                item_rows.append(dict(cur.fetchone()))
            conn.commit()

    items = [_serialize_item(row) for row in item_rows]
    return _serialize_job(job_row, items)


def get_upload_job(user_id: int, job_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        job_row = _load_job(conn, job_id=job_id, user_id=user_id)
        if not job_row:
            return None
        items = _load_job_items(conn, str(job_row["id"]))
    return _serialize_job(job_row, items)


def get_upload_job_for_processing(job_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        job_row = _load_job(conn, job_id=job_id)
        if not job_row:
            return None
        items = _load_job_items(conn, str(job_row["id"]))
    return _serialize_job(job_row, items)


def get_active_upload_job(user_id: int, collection_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        row = conn.execute(
            f"""
            SELECT {_JOB_COLUMNS}
            FROM favorite_collection_upload_jobs
            WHERE user_id = %s
              AND collection_id = %s
              AND status = ANY(%s)
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            [user_id, collection_id, list(_ACTIVE_JOB_STATUSES)],
        ).fetchone()
        if not row:
            return None
        job_row = dict(row)
        items = _load_job_items(conn, str(job_row["id"]))
    return _serialize_job(job_row, items)


def fail_stale_upload_jobs(
    reason: str,
    stale_seconds: int,
    *,
    user_id: int | None = None,
    collection_id: str | None = None,
    job_id: str | None = None,
) -> list[dict[str, Any]]:
    where_clause, params = _build_stale_job_where_clause(
        stale_seconds=stale_seconds,
        user_id=user_id,
        collection_id=collection_id,
        job_id=job_id,
    )

    with pg_connection() as conn:
        stale_rows = conn.execute(
            f"""
            SELECT {_JOB_COLUMNS}
            FROM favorite_collection_upload_jobs
            WHERE {where_clause}
            ORDER BY created_at ASC, id ASC
            """,
            params,
        ).fetchall()

        if not stale_rows:
            return []

        jobs: list[dict[str, Any]] = []
        job_ids: list[str] = []
        for row in stale_rows:
            job_row = dict(row)
            current_job_id = str(job_row["id"])
            job_ids.append(current_job_id)
            jobs.append(_serialize_job(job_row, _load_job_items(conn, current_job_id)))

        conn.execute(
            """
            UPDATE favorite_collection_upload_job_items
            SET status = CASE
                    WHEN status IN ('pending', 'uploaded', 'processing') THEN 'failed'
                    ELSE status
                END,
                error_message = COALESCE(error_message, %s),
                completed_at = COALESCE(completed_at, NOW())
            WHERE job_id = ANY(%s)
            """,
            [reason[:2000], job_ids],
        )
        conn.execute(
            """
            UPDATE favorite_collection_upload_jobs
            SET status = 'failed',
                error_message = %s,
                completed_at = COALESCE(completed_at, NOW())
            WHERE id = ANY(%s)
            """,
            [reason[:4000], job_ids],
        )
        conn.commit()

    return jobs


def _update_job_status(
    conn,
    *,
    job_id: str,
    next_status: str,
    error_message: str | None = None,
    set_started: bool = False,
    set_completed: bool = False,
) -> dict[str, Any] | None:
    assignments = ["status = %s", "error_message = %s"]
    params: list[Any] = [next_status, error_message[:4000] if error_message else None]
    if set_started:
        assignments.append("started_at = COALESCE(started_at, NOW())")
    if set_completed:
        assignments.append("completed_at = NOW()")
    row = conn.execute(
        f"""
        UPDATE favorite_collection_upload_jobs
        SET {', '.join(assignments)}
        WHERE id = %s
        RETURNING {_JOB_COLUMNS}
        """,
        params + [job_id],
    ).fetchone()
    return dict(row) if row else None


def mark_upload_item_uploaded(user_id: int, job_id: str, item_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        row = conn.execute(
            """
            UPDATE favorite_collection_upload_job_items AS item
            SET status = 'uploaded',
                error_message = NULL,
                completed_at = NULL,
                started_at = COALESCE(item.started_at, NOW())
            FROM favorite_collection_upload_jobs AS job
            WHERE item.id = %s
              AND item.job_id = job.id
              AND job.id = %s
              AND job.user_id = %s
            RETURNING item.id
            """,
            [item_id, job_id, user_id],
        ).fetchone()
        if not row:
            return None
        _update_job_status(conn, job_id=job_id, next_status='uploading')
        conn.commit()
    return get_upload_job(user_id, job_id)


def mark_upload_item_failed(user_id: int, job_id: str, item_id: str, error_message: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        row = conn.execute(
            """
            UPDATE favorite_collection_upload_job_items AS item
            SET status = 'upload_failed',
                error_message = %s,
                completed_at = NOW()
            FROM favorite_collection_upload_jobs AS job
            WHERE item.id = %s
              AND item.job_id = job.id
              AND job.id = %s
              AND job.user_id = %s
            RETURNING item.id
            """,
            [error_message[:2000], item_id, job_id, user_id],
        ).fetchone()
        if not row:
            return None
        _update_job_status(conn, job_id=job_id, next_status='uploading')
        conn.commit()
    return get_upload_job(user_id, job_id)


def mark_upload_job_queued(user_id: int, job_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        job_row = _load_job(conn, job_id=job_id, user_id=user_id)
        if not job_row:
            return None
        updated = _update_job_status(conn, job_id=job_id, next_status='queued', set_started=True)
        items = _load_job_items(conn, job_id)
        conn.commit()
    return _serialize_job(updated or job_row, items)


def mark_upload_job_processing(job_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        updated = _update_job_status(conn, job_id=job_id, next_status='processing', set_started=True)
        items = _load_job_items(conn, job_id) if updated else []
        conn.commit()
    return _serialize_job(updated, items) if updated else None


def mark_upload_job_terminal(job_id: str, status: str, error_message: str | None = None) -> dict[str, Any] | None:
    with pg_connection() as conn:
        updated = _update_job_status(
            conn,
            job_id=job_id,
            next_status=status,
            error_message=error_message,
            set_started=True,
            set_completed=True,
        )
        items = _load_job_items(conn, job_id) if updated else []
        conn.commit()
    return _serialize_job(updated, items) if updated else None


def list_uploaded_items(job_id: str) -> list[dict[str, Any]]:
    with pg_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT {_ITEM_COLUMNS}
            FROM favorite_collection_upload_job_items
            WHERE job_id = %s
              AND status = 'uploaded'
            ORDER BY sort_order ASC, created_at ASC, id ASC
            """,
            [job_id],
        ).fetchall()
    return [_serialize_item(dict(row)) for row in rows]


def mark_upload_item_processing(job_id: str, item_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        row = conn.execute(
            f"""
            UPDATE favorite_collection_upload_job_items
            SET status = 'processing',
                error_message = NULL,
                started_at = COALESCE(started_at, NOW())
            WHERE job_id = %s
              AND id = %s
            RETURNING {_ITEM_COLUMNS}
            """,
            [job_id, item_id],
        ).fetchone()
        conn.commit()
    return _serialize_item(dict(row)) if row else None


def mark_upload_item_completed(job_id: str, item_id: str, favorite_item_image_id: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        row = conn.execute(
            f"""
            UPDATE favorite_collection_upload_job_items
            SET status = 'completed',
                favorite_item_image_id = %s,
                error_message = NULL,
                completed_at = NOW()
            WHERE job_id = %s
              AND id = %s
            RETURNING {_ITEM_COLUMNS}
            """,
            [favorite_item_image_id, job_id, item_id],
        ).fetchone()
        conn.commit()
    return _serialize_item(dict(row)) if row else None


def mark_upload_item_processing_failed(job_id: str, item_id: str, error_message: str) -> dict[str, Any] | None:
    with pg_connection() as conn:
        row = conn.execute(
            f"""
            UPDATE favorite_collection_upload_job_items
            SET status = 'failed',
                error_message = %s,
                completed_at = NOW()
            WHERE job_id = %s
              AND id = %s
            RETURNING {_ITEM_COLUMNS}
            """,
            [error_message[:2000], job_id, item_id],
        ).fetchone()
        conn.commit()
    return _serialize_item(dict(row)) if row else None


def fail_incomplete_upload_jobs(reason: str) -> int:
    return len(fail_stale_upload_jobs(reason, 0))
