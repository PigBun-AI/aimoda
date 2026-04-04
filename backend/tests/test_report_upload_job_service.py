from pathlib import Path

from backend.app.models import ReportRecord, ReportUploadJobRecord
from backend.app.services import report_upload_job_service


def _job(job_id: str = "job-1", status: str = "pending") -> ReportUploadJobRecord:
    return ReportUploadJobRecord(
        id=job_id,
        filename="report.zip",
        status=status,
        uploaded_by=1,
        file_size_bytes=12,
        source_object_key=f"report-uploads/{job_id}/report.zip",
        report_id=None,
        report_slug=None,
        error_message=None,
        created_at="2026-04-04T00:00:00Z",
        updated_at="2026-04-04T00:00:00Z",
        started_at=None,
        completed_at=None,
    )


def test_enqueue_report_upload_job_stores_archive_and_dispatches_worker(tmp_path, monkeypatch):
    submitted = {}

    monkeypatch.setattr(report_upload_job_service.settings, "UPLOAD_TMP_DIR", str(tmp_path))
    monkeypatch.setattr(
        report_upload_job_service,
        "create_upload_job",
        lambda job_id, filename, uploaded_by, file_size_bytes, source_object_key=None: _job(job_id=job_id),
    )

    class FakeExecutor:
        def submit(self, fn, *args):
            submitted["fn"] = fn
            submitted["args"] = args

    monkeypatch.setattr(report_upload_job_service, "_executor", FakeExecutor())

    job = report_upload_job_service.enqueue_report_upload_job(
        filename="report.zip",
        file_bytes=b"zip-bytes",
        uploaded_by=1,
    )

    archive_path = Path(submitted["args"][1])
    assert job.id
    assert archive_path.exists()
    assert archive_path.read_bytes() == b"zip-bytes"
    assert submitted["fn"] == report_upload_job_service._process_report_upload_job


def test_process_report_upload_job_marks_completion(tmp_path, monkeypatch):
    archive_path = tmp_path / "job.zip"
    archive_path.write_bytes(b"zip-bytes")
    captured = {}

    def _fake_upload_report_archive(archive_path: str, uploaded_by: int):
        captured["archive_path"] = archive_path
        captured["uploaded_by"] = uploaded_by
        return ReportRecord(
            id=3,
            slug="murmur-aw-2026-27-v5-2",
            title="Murmur",
            brand="Murmur",
            season="AW",
            year=2026,
            look_count=32,
            index_url="https://oss.example.com/report.html",
            overview_url=None,
            cover_url=None,
            oss_prefix="reports/murmur-aw-2026-27-v5-2",
            uploaded_by=1,
            metadata_json=None,
            created_at="2026-04-04T00:00:00Z",
            updated_at="2026-04-04T00:00:00Z",
        )

    monkeypatch.setattr(report_upload_job_service, "upload_report_archive", _fake_upload_report_archive)
    monkeypatch.setattr(report_upload_job_service, "mark_upload_job_processing", lambda job_id: None)

    completion = {}
    monkeypatch.setattr(
        report_upload_job_service,
        "mark_upload_job_completed",
        lambda job_id, report_id, report_slug: completion.update(
            {"job_id": job_id, "report_id": report_id, "report_slug": report_slug}
        ),
    )

    report_upload_job_service._process_report_upload_job("job-1", archive_path, uploaded_by=99)

    assert captured == {"archive_path": str(archive_path), "uploaded_by": 99}
    assert completion == {
        "job_id": "job-1",
        "report_id": 3,
        "report_slug": "murmur-aw-2026-27-v5-2",
    }


def test_process_report_upload_job_marks_failure(tmp_path, monkeypatch):
    archive_path = tmp_path / "job.zip"
    archive_path.write_bytes(b"zip-bytes")

    monkeypatch.setattr(report_upload_job_service, "mark_upload_job_processing", lambda job_id: None)
    monkeypatch.setattr(
        report_upload_job_service,
        "upload_report_archive",
        lambda archive_path, uploaded_by: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    failure = {}
    monkeypatch.setattr(
        report_upload_job_service,
        "mark_upload_job_failed",
        lambda job_id, error_message: failure.update({"job_id": job_id, "error_message": error_message}),
    )

    report_upload_job_service._process_report_upload_job("job-2", archive_path, uploaded_by=99)

    assert failure["job_id"] == "job-2"
    assert failure["error_message"] == "boom"
    assert not archive_path.exists()


def test_prepare_direct_upload_job_returns_signed_upload_target(monkeypatch):
    monkeypatch.setattr(
        report_upload_job_service,
        "create_upload_job",
        lambda job_id, filename, uploaded_by, file_size_bytes, source_object_key=None: _job(job_id=job_id),
    )

    class FakeOSS:
        def get_signed_upload_url(self, oss_path: str, *, expires_seconds: int = 900, content_type: str = "application/zip"):
            return f"https://oss.example.com/{oss_path}?signature=abc", {"Content-Type": content_type}

    monkeypatch.setattr(report_upload_job_service, "get_oss_service", lambda: FakeOSS())
    monkeypatch.setattr(
        report_upload_job_service.OSSService,
        "report_upload_staging_path",
        staticmethod(lambda job_id, filename: f"report-uploads/{job_id}/{filename}"),
    )

    result = report_upload_job_service.prepare_direct_upload_job(
        filename="report.zip",
        file_size_bytes=1024,
        uploaded_by=1,
    )

    assert result["job"].filename == "report.zip"
    assert result["upload"]["method"] == "PUT"
    assert result["upload"]["object_key"].startswith("report-uploads/")
    assert result["upload"]["url"].startswith("https://oss.example.com/")


def test_complete_direct_upload_job_dispatches_oss_worker(monkeypatch):
    submitted = {}
    monkeypatch.setattr(report_upload_job_service, "get_upload_job", lambda job_id: _job(job_id=job_id))

    class FakeOSS:
        def exists(self, oss_path: str):
            return True

    monkeypatch.setattr(report_upload_job_service, "get_oss_service", lambda: FakeOSS())
    monkeypatch.setattr(report_upload_job_service, "mark_upload_job_processing", lambda job_id: _job(job_id=job_id, status="processing"))

    class FakeExecutor:
        def submit(self, fn, *args):
            submitted["fn"] = fn
            submitted["args"] = args

    monkeypatch.setattr(report_upload_job_service, "_executor", FakeExecutor())

    job = report_upload_job_service.complete_direct_upload_job(job_id="job-3", uploaded_by=1)

    assert job.status == "processing"
    assert submitted["fn"] == report_upload_job_service._process_report_upload_job_from_oss
    assert submitted["args"] == ("job-3", "report-uploads/job-3/report.zip", 1)


def test_process_report_upload_job_from_oss_downloads_and_cleans_up(monkeypatch, tmp_path):
    captured = {}
    monkeypatch.setattr(report_upload_job_service.settings, "UPLOAD_TMP_DIR", str(tmp_path))

    class FakeOSS:
        def download_file_to_path(self, oss_path: str, destination: str):
            Path(destination).write_bytes(b"zip-bytes")
            captured["download"] = (oss_path, destination)

        def delete_file(self, oss_path: str):
            captured["deleted"] = oss_path

    monkeypatch.setattr(report_upload_job_service, "get_oss_service", lambda: FakeOSS())

    def _fake_upload_report_archive(archive_path: str, uploaded_by: int):
        captured["archive_path"] = archive_path
        captured["uploaded_by"] = uploaded_by
        return ReportRecord(
            id=4,
            slug="prepared-report",
            title="Prepared",
            brand="Prepared",
            season="AW",
            year=2026,
            look_count=20,
            index_url="https://oss.example.com/report.html",
            overview_url=None,
            cover_url=None,
            oss_prefix="reports/prepared-report",
            uploaded_by=uploaded_by,
            metadata_json=None,
            created_at="2026-04-04T00:00:00Z",
            updated_at="2026-04-04T00:00:00Z",
        )

    monkeypatch.setattr(report_upload_job_service, "upload_report_archive", _fake_upload_report_archive)
    completion = {}
    monkeypatch.setattr(
        report_upload_job_service,
        "mark_upload_job_completed",
        lambda job_id, report_id, report_slug: completion.update(
            {"job_id": job_id, "report_id": report_id, "report_slug": report_slug}
        ),
    )

    report_upload_job_service._process_report_upload_job_from_oss(
        "job-9",
        "report-uploads/job-9/report.zip",
        uploaded_by=77,
    )

    assert captured["download"][0] == "report-uploads/job-9/report.zip"
    assert captured["uploaded_by"] == 77
    assert captured["deleted"] == "report-uploads/job-9/report.zip"
    assert completion == {"job_id": "job-9", "report_id": 4, "report_slug": "prepared-report"}
