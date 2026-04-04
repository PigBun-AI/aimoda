import io

import pytest
from fastapi import UploadFile

from backend.app.models import AuthenticatedUser, ReportUploadJobRecord
from backend.app.routers import reports as reports_router


def _editor() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=2,
        email="editor@aimoda.ai",
        role="editor",
        session_id=5,
    )


def _job(status: str = "pending") -> ReportUploadJobRecord:
    return ReportUploadJobRecord(
        id="job-123",
        filename="report.zip",
        status=status,
        uploaded_by=2,
        file_size_bytes=128,
        report_id=None,
        report_slug=None,
        error_message=None,
        created_at="2026-04-04T00:00:00Z",
        updated_at="2026-04-04T00:00:00Z",
        started_at=None,
        completed_at=None,
    )


@pytest.mark.asyncio
async def test_upload_report_returns_async_job(monkeypatch):
    monkeypatch.setattr(
        reports_router,
        "enqueue_report_upload_job",
        lambda filename, file_bytes, uploaded_by: _job(),
    )

    upload = UploadFile(filename="report.zip", file=io.BytesIO(b"zip-content"))
    response = await reports_router.upload_report(user=_editor(), file=upload)

    assert response["success"] is True
    assert response["data"]["id"] == "job-123"
    assert response["data"]["status"] == "pending"


def test_get_upload_job_status_returns_job(monkeypatch):
    monkeypatch.setattr(reports_router, "get_report_upload_job", lambda job_id: _job(status="processing"))

    response = reports_router.get_upload_job_status(job_id="job-123", user=_editor())

    assert response["success"] is True
    assert response["data"]["status"] == "processing"
