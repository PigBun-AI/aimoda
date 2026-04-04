import io

import pytest
from fastapi import UploadFile

from backend.app.config import settings
from backend.app.exceptions import AppError
from backend.app.models import ReportRecord, ReportUploadJobRecord
from backend.app.routers import report_mcp_internal
from backend.app.dependencies import require_report_mcp_internal_service


def _report() -> ReportRecord:
    return ReportRecord(
        id=7,
        slug="murmur-aw-2026-27-v5-2",
        title="Murmur 2026-27 秋冬 时装周快报",
        brand="Murmur",
        season="AW",
        year=2026,
        look_count=38,
        index_url="https://oss.example.com/reports/murmur/pages/report.html",
        overview_url=None,
        cover_url="https://oss.example.com/reports/murmur/assets/cover.jpg",
        oss_prefix="reports/murmur-aw-2026-27-v5-2",
        uploaded_by=1,
        metadata_json=None,
        created_at="2026-04-04T00:00:00Z",
        updated_at="2026-04-04T00:00:00Z",
    )


def test_require_report_mcp_internal_service_accepts_valid_token(monkeypatch):
    monkeypatch.setattr(settings, "REPORT_MCP_INTERNAL_TOKEN", "token-123")

    service_name = require_report_mcp_internal_service(
        x_internal_token="token-123",
        x_internal_service="fashion-report-mcp",
    )

    assert service_name == "fashion-report-mcp"


def test_require_report_mcp_internal_service_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr(settings, "REPORT_MCP_INTERNAL_TOKEN", "token-123")

    with pytest.raises(AppError) as exc:
        require_report_mcp_internal_service(
            x_internal_token="wrong-token",
            x_internal_service="fashion-report-mcp",
        )

    assert exc.value.status_code == 401


def test_list_reports_for_mcp_returns_slug_payload(monkeypatch):
    monkeypatch.setattr(report_mcp_internal, "find_report_by_slug", lambda slug: _report())

    response = report_mcp_internal.list_reports_for_mcp(
        service_name="fashion-report-mcp",
        slug="murmur-aw-2026-27-v5-2",
        page=1,
        limit=20,
    )

    assert response["success"] is True
    assert response["found"] is True
    assert response["report"]["slug"] == "murmur-aw-2026-27-v5-2"
    assert response["report"]["lookCount"] == 38


@pytest.mark.asyncio
async def test_upload_report_for_mcp_uses_service_user_id(monkeypatch):
    captured = {}

    def _fake_upload_report_archive(*, archive_path: str, uploaded_by: int):
        captured["archive_path"] = archive_path
        captured["uploaded_by"] = uploaded_by
        return _report()

    monkeypatch.setattr(report_mcp_internal, "upload_report_archive", _fake_upload_report_archive)
    monkeypatch.setattr(settings, "REPORT_MCP_SERVICE_USER_ID", 99)

    upload = UploadFile(filename="report.zip", file=io.BytesIO(b"zip-content"))
    response = await report_mcp_internal.upload_report_for_mcp(
        service_name="fashion-report-mcp",
        file=upload,
    )

    assert response["success"] is True
    assert response["report"]["slug"] == "murmur-aw-2026-27-v5-2"
    assert response["report"]["season"] == "AW 2026"
    assert captured["uploaded_by"] == 99
    assert captured["archive_path"].endswith(".zip")


def test_prepare_report_upload_for_mcp_returns_signed_target(monkeypatch):
    monkeypatch.setattr(settings, "REPORT_MCP_SERVICE_USER_ID", 99)
    monkeypatch.setattr(
        report_mcp_internal,
        "prepare_direct_upload_job",
        lambda **kwargs: {
            "job": ReportUploadJobRecord(
                id="job-1",
                filename="report.zip",
                status="pending",
                uploaded_by=99,
                file_size_bytes=123,
                source_object_key="report-uploads/job-1/report.zip",
                report_id=None,
                report_slug=None,
                error_message=None,
                created_at="2026-04-04T00:00:00Z",
                updated_at="2026-04-04T00:00:00Z",
                started_at=None,
                completed_at=None,
            ),
            "upload": {
                "method": "PUT",
                "url": "https://oss.example.com/report-uploads/job-1/report.zip?signature=abc",
                "headers": {"Content-Type": "application/zip"},
                "object_key": "report-uploads/job-1/report.zip",
                "content_type": "application/zip",
                "expires_at": "2026-04-05T00:10:00Z",
            },
        },
    )

    response = report_mcp_internal.prepare_report_upload_for_mcp(
        body=report_mcp_internal.PrepareReportUploadRequest(filename="report.zip", file_size_bytes=123),
        service_name="fashion-report-mcp",
    )

    assert response["success"] is True
    assert response["upload"]["method"] == "PUT"
    assert response["upload"]["objectKey"] == "report-uploads/job-1/report.zip"


def test_complete_report_upload_for_mcp_returns_processing_job(monkeypatch):
    monkeypatch.setattr(
        report_mcp_internal,
        "get_report_upload_job",
        lambda job_id: ReportUploadJobRecord(
            id=job_id,
            filename="report.zip",
            status="pending",
            uploaded_by=99,
            file_size_bytes=123,
            source_object_key="report-uploads/job-1/report.zip",
            report_id=None,
            report_slug=None,
            error_message=None,
            created_at="2026-04-04T00:00:00Z",
            updated_at="2026-04-04T00:00:00Z",
            started_at=None,
            completed_at=None,
        ),
    )
    monkeypatch.setattr(settings, "REPORT_MCP_SERVICE_USER_ID", 99)
    monkeypatch.setattr(
        report_mcp_internal,
        "complete_direct_upload_job",
        lambda job_id, uploaded_by: ReportUploadJobRecord(
            id=job_id,
            filename="report.zip",
            status="processing",
            uploaded_by=uploaded_by,
            file_size_bytes=123,
            source_object_key="report-uploads/job-1/report.zip",
            report_id=None,
            report_slug=None,
            error_message=None,
            created_at="2026-04-04T00:00:00Z",
            updated_at="2026-04-04T00:00:00Z",
            started_at="2026-04-04T00:01:00Z",
            completed_at=None,
        ),
    )

    response = report_mcp_internal.complete_report_upload_for_mcp(
        body=report_mcp_internal.CompleteReportUploadRequest(job_id="job-1", object_key="report-uploads/job-1/report.zip"),
        service_name="fashion-report-mcp",
    )

    assert response["success"] is True
    assert response["job"]["status"] == "processing"


def test_get_report_upload_job_for_mcp_returns_job(monkeypatch):
    monkeypatch.setattr(
        report_mcp_internal,
        "get_report_upload_job",
        lambda job_id: ReportUploadJobRecord(
            id=job_id,
            filename="report.zip",
            status="completed",
            uploaded_by=99,
            file_size_bytes=123,
            source_object_key="report-uploads/job-1/report.zip",
            report_id=7,
            report_slug="murmur-aw-2026-27-v5-2",
            error_message=None,
            created_at="2026-04-04T00:00:00Z",
            updated_at="2026-04-04T00:05:00Z",
            started_at="2026-04-04T00:01:00Z",
            completed_at="2026-04-04T00:05:00Z",
        ),
    )

    response = report_mcp_internal.get_report_upload_job_for_mcp(
        job_id="job-1",
        service_name="fashion-report-mcp",
    )

    assert response["success"] is True
    assert response["job"]["status"] == "completed"
    assert response["job"]["reportSlug"] == "murmur-aw-2026-27-v5-2"
