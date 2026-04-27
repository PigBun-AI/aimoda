from pathlib import Path

from backend.app.models import TrendFlowRecord, TrendFlowUploadJobRecord
from backend.app.services import trend_flow_upload_job_service


def _job(job_id: str = "job-1", status: str = "pending", uploaded_by: int = 1) -> TrendFlowUploadJobRecord:
    return TrendFlowUploadJobRecord(
        id=job_id,
        filename="trend-flow.zip",
        status=status,
        uploaded_by=uploaded_by,
        file_size_bytes=12,
        source_object_key=f"trend-flow-uploads/{job_id}/trend-flow.zip",
        trend_flow_id=None,
        trend_flow_slug=None,
        error_message=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        started_at=None,
        completed_at=None,
    )


def _trend_flow(uploaded_by: int = 1) -> TrendFlowRecord:
    return TrendFlowRecord(
        id=11,
        slug="miumiu-2025-trend-flow",
        title="Miu Miu 趋势流动：2025",
        brand="Miu Miu",
        start_quarter="早春",
        start_year=2025,
        end_quarter="秋冬",
        end_year=2025,
        index_url="https://oss.example.com/trend-flow/miumiu/pages/report.html",
        overview_url=None,
        cover_url=None,
        oss_prefix="trend-flow/miumiu-2025-trend-flow",
        uploaded_by=uploaded_by,
        timeline_json="[]",
        metadata_json="{}",
        lead_excerpt=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
    )


def test_prepare_direct_trend_flow_upload_job_returns_signed_upload_target(monkeypatch):
    monkeypatch.setattr(
        trend_flow_upload_job_service,
        "create_upload_job",
        lambda job_id, filename, uploaded_by, file_size_bytes, source_object_key=None: _job(job_id=job_id, uploaded_by=uploaded_by),
    )

    class FakeOSS:
        def get_signed_upload_url(self, oss_path: str, *, expires_seconds: int = 900, content_type: str = "application/zip"):
            return f"https://oss.example.com/{oss_path}?signature=abc", {"Content-Type": content_type}

    monkeypatch.setattr(trend_flow_upload_job_service, "get_oss_service", lambda: FakeOSS())
    monkeypatch.setattr(
        trend_flow_upload_job_service.OSSService,
        "trend_flow_upload_staging_path",
        staticmethod(lambda job_id, filename: f"trend-flow-uploads/{job_id}/{filename}"),
    )

    result = trend_flow_upload_job_service.prepare_direct_trend_flow_upload_job(
        filename="trend-flow.zip",
        file_size_bytes=1024,
        uploaded_by=88,
    )

    assert result["job"].filename == "trend-flow.zip"
    assert result["job"].uploaded_by == 88
    assert result["upload"]["method"] == "PUT"
    assert result["upload"]["object_key"].startswith("trend-flow-uploads/")


def test_complete_direct_trend_flow_upload_job_dispatches_oss_worker(monkeypatch):
    submitted = {}
    monkeypatch.setattr(trend_flow_upload_job_service, "get_upload_job", lambda job_id: _job(job_id=job_id, uploaded_by=88))

    class FakeOSS:
        def exists(self, oss_path: str):
            return True

    monkeypatch.setattr(trend_flow_upload_job_service, "get_oss_service", lambda: FakeOSS())
    monkeypatch.setattr(
        trend_flow_upload_job_service,
        "mark_upload_job_processing",
        lambda job_id: _job(job_id=job_id, status="processing", uploaded_by=88),
    )

    class FakeExecutor:
        def submit(self, fn, *args):
            submitted["fn"] = fn
            submitted["args"] = args

    monkeypatch.setattr(trend_flow_upload_job_service, "_executor", FakeExecutor())

    job = trend_flow_upload_job_service.complete_direct_trend_flow_upload_job(job_id="job-3", uploaded_by=88)

    assert job.status == "processing"
    assert submitted["fn"] == trend_flow_upload_job_service._process_trend_flow_upload_job_from_oss
    assert submitted["args"] == ("job-3", "trend-flow-uploads/job-3/trend-flow.zip", 88)


def test_process_trend_flow_upload_job_from_oss_downloads_and_cleans_up(monkeypatch, tmp_path):
    captured = {}
    monkeypatch.setattr(trend_flow_upload_job_service.settings, "UPLOAD_TMP_DIR", str(tmp_path))

    class FakeOSS:
        def download_file_to_path(self, oss_path: str, destination: str):
            Path(destination).write_bytes(b"zip-bytes")
            captured["download"] = (oss_path, destination)

        def delete_file(self, oss_path: str):
            captured["deleted"] = oss_path

    monkeypatch.setattr(trend_flow_upload_job_service, "get_oss_service", lambda: FakeOSS())

    def _fake_upload_trend_flow_archive(archive_path: str, uploaded_by: int):
        captured["archive_path"] = archive_path
        captured["uploaded_by"] = uploaded_by
        return _trend_flow(uploaded_by=uploaded_by)

    monkeypatch.setattr(trend_flow_upload_job_service, "upload_trend_flow_archive", _fake_upload_trend_flow_archive)
    completion = {}
    monkeypatch.setattr(
        trend_flow_upload_job_service,
        "mark_upload_job_completed",
        lambda job_id, trend_flow_id, trend_flow_slug: completion.update(
            {"job_id": job_id, "trend_flow_id": trend_flow_id, "trend_flow_slug": trend_flow_slug}
        ),
    )

    trend_flow_upload_job_service._process_trend_flow_upload_job_from_oss(
        "job-9",
        "trend-flow-uploads/job-9/trend-flow.zip",
        uploaded_by=77,
    )

    assert captured["download"][0] == "trend-flow-uploads/job-9/trend-flow.zip"
    assert captured["uploaded_by"] == 77
    assert captured["deleted"] == "trend-flow-uploads/job-9/trend-flow.zip"
    assert completion == {"job_id": "job-9", "trend_flow_id": 11, "trend_flow_slug": "miumiu-2025-trend-flow"}
