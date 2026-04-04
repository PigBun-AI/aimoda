"""
Report Upload Job Repository — PostgreSQL-backed async upload job tracking.
"""

from __future__ import annotations

import psycopg

from ..config import settings
from ..models import ReportUploadJobRecord


def _get_pg_conn():
    return psycopg.connect(settings.POSTGRES_DSN)


def _map_job(row) -> ReportUploadJobRecord:
    return ReportUploadJobRecord(
        id=row[0],
        filename=row[1],
        status=row[2],
        uploaded_by=row[3],
        file_size_bytes=row[4],
        report_id=row[5],
        report_slug=row[6],
        error_message=row[7],
        started_at=row[8].isoformat() if row[8] else None,
        completed_at=row[9].isoformat() if row[9] else None,
        created_at=row[10].isoformat() if row[10] else "",
        updated_at=row[11].isoformat() if row[11] else "",
    )


_JOB_COLUMNS = """
    id, filename, status, uploaded_by, file_size_bytes,
    report_id, report_slug, error_message, started_at, completed_at,
    created_at, updated_at
"""


def create_upload_job(job_id: str, filename: str, uploaded_by: int, file_size_bytes: int) -> ReportUploadJobRecord:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            INSERT INTO report_upload_jobs (id, filename, status, uploaded_by, file_size_bytes)
            VALUES (%s, %s, 'pending', %s, %s)
            RETURNING {_JOB_COLUMNS}
            """,
            (job_id, filename, uploaded_by, file_size_bytes),
        ).fetchone()
        conn.commit()
    return _map_job(row)


def get_upload_job(job_id: str) -> ReportUploadJobRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"SELECT {_JOB_COLUMNS} FROM report_upload_jobs WHERE id = %s",
            (job_id,),
        ).fetchone()
    return _map_job(row) if row else None


def mark_upload_job_processing(job_id: str) -> ReportUploadJobRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            UPDATE report_upload_jobs
            SET status = 'processing',
                error_message = NULL,
                started_at = COALESCE(started_at, NOW())
            WHERE id = %s
            RETURNING {_JOB_COLUMNS}
            """,
            (job_id,),
        ).fetchone()
        conn.commit()
    return _map_job(row) if row else None


def mark_upload_job_completed(job_id: str, report_id: int, report_slug: str) -> ReportUploadJobRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            UPDATE report_upload_jobs
            SET status = 'completed',
                report_id = %s,
                report_slug = %s,
                error_message = NULL,
                completed_at = NOW()
            WHERE id = %s
            RETURNING {_JOB_COLUMNS}
            """,
            (report_id, report_slug, job_id),
        ).fetchone()
        conn.commit()
    return _map_job(row) if row else None


def mark_upload_job_failed(job_id: str, error_message: str) -> ReportUploadJobRecord | None:
    with _get_pg_conn() as conn:
        row = conn.execute(
            f"""
            UPDATE report_upload_jobs
            SET status = 'failed',
                error_message = %s,
                completed_at = NOW()
            WHERE id = %s
            RETURNING {_JOB_COLUMNS}
            """,
            (error_message[:4000], job_id),
        ).fetchone()
        conn.commit()
    return _map_job(row) if row else None


def fail_incomplete_upload_jobs(reason: str) -> int:
    with _get_pg_conn() as conn:
        result = conn.execute(
            """
            UPDATE report_upload_jobs
            SET status = 'failed',
                error_message = %s,
                completed_at = COALESCE(completed_at, NOW())
            WHERE status IN ('pending', 'processing')
            """,
            (reason[:4000],),
        )
        conn.commit()
        return result.rowcount
