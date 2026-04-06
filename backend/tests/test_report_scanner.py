import json

import pytest

from backend.app.services.report_package_errors import ReportPackageError
from backend.app.services.report_scanner import extract_report_metadata, validate_report_directory


def test_extract_report_metadata_from_manifest_package(tmp_path):
    report_root = tmp_path / "Murmur-2026-27秋冬-v5.2-report"
    (report_root / "pages").mkdir(parents=True)
    (report_root / "assets").mkdir()

    (report_root / "pages" / "report.html").write_text(
        "<html><head><title>Murmur 2026-27 秋冬 时装周快报</title></head><body></body></html>",
        encoding="utf-8",
    )
    (report_root / "pages" / "data.html").write_text("<html><body>data</body></html>", encoding="utf-8")
    (report_root / "assets" / "cover.jpg").write_bytes(b"cover")
    (report_root / "assets" / "look-001.jpg").write_bytes(b"img1")
    (report_root / "assets" / "look-002.jpg").write_bytes(b"img2")
    (report_root / "image-features.json").write_text(
        json.dumps({"look-1.jpg": {"style": "minimal"}, "look-2.jpg": {"style": "tailored"}}),
        encoding="utf-8",
    )
    (report_root / "manifest.json").write_text(
        json.dumps(
            {
                "specVersion": "2.0",
                "slug": "murmur-aw-2026-27-v5-2",
                "title": "Murmur 2026-27 秋冬 时装周快报",
                "brand": "Murmur",
                "season": "AW",
                "year": 2026,
                "entryHtml": "pages/report.html",
                "pages": ["pages/report.html", "pages/data.html"],
                "coverImage": "assets/cover.jpg",
                "featuresFile": "image-features.json",
            }
        ),
        encoding="utf-8",
    )

    validate_report_directory(report_root)
    metadata = extract_report_metadata(report_root)

    assert metadata.model_dump() == {
        "slug": "murmur-aw-2026-27-v5-2",
        "title": "Murmur 2026-27 秋冬 时装周快报",
        "brand": "Murmur",
        "season": "AW",
        "year": 2026,
        "look_count": 2,
    }


def test_legacy_report_without_overview_is_still_valid(tmp_path):
    report_root = tmp_path / "zimmermann-fall-2026"
    report_root.mkdir()
    (report_root / "index.html").write_text(
        "<html><head><title>Zimmermann Fall 2026 RTW</title></head><body></body></html>",
        encoding="utf-8",
    )
    (report_root / "cover.jpg").write_bytes(b"cover")
    (report_root / "look-001.jpg").write_bytes(b"img1")

    validate_report_directory(report_root)
    metadata = extract_report_metadata(report_root)

    assert metadata.slug == "zimmermann-fall-2026"
    assert metadata.brand == "Zimmermann"
    assert metadata.season == "Fall"
    assert metadata.year == 2026
    assert metadata.look_count == 1


def test_manifest_without_cover_image_uses_first_entry_image(tmp_path):
    report_root = tmp_path / "auto-cover-report"
    (report_root / "pages").mkdir(parents=True)
    (report_root / "assets").mkdir()
    (report_root / "pages" / "report.html").write_text(
        '<html><head><title>Auto Cover</title></head><body><img src="../assets/look-001.jpg"><img src="../assets/look-002.jpg"></body></html>',
        encoding="utf-8",
    )
    (report_root / "assets" / "look-001.jpg").write_bytes(b"img1")
    (report_root / "assets" / "look-002.jpg").write_bytes(b"img2")
    (report_root / "manifest.json").write_text(
        json.dumps(
            {
                "slug": "auto-cover-report",
                "brand": "Auto",
                "season": "AW",
                "year": 2026,
                "entryHtml": "pages/report.html",
            }
        ),
        encoding="utf-8",
    )

    validate_report_directory(report_root)
    metadata = extract_report_metadata(report_root)

    assert metadata.look_count == 2


def test_manifest_entry_html_missing_raises(tmp_path):
    report_root = tmp_path / "broken-report"
    report_root.mkdir()
    (report_root / "assets").mkdir()
    (report_root / "assets" / "cover.jpg").write_bytes(b"cover")
    (report_root / "manifest.json").write_text(
        json.dumps(
            {
                "slug": "broken-report",
                "brand": "Broken",
                "season": "AW",
                "year": 2026,
                "entryHtml": "pages/missing.html",
                "coverImage": "assets/cover.jpg",
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ReportPackageError) as exc:
        validate_report_directory(report_root)

    assert exc.value.code == "entry_html_not_found"


def test_legacy_report_without_cover_raises(tmp_path):
    report_root = tmp_path / "zimmermann-fall-2026"
    report_root.mkdir()
    (report_root / "index.html").write_text(
        "<html><head><title>Zimmermann Fall 2026 RTW</title></head><body></body></html>",
        encoding="utf-8",
    )

    with pytest.raises(ReportPackageError) as exc:
        validate_report_directory(report_root)

    assert exc.value.code == "cover_image_not_found"


def test_large_inline_image_is_rejected(tmp_path):
    report_root = tmp_path / "inline-report"
    (report_root / "pages").mkdir(parents=True)
    inline_payload = "a" * (9 * 1024)
    (report_root / "pages" / "report.html").write_text(
        f'<html><head><title>Inline</title></head><body><img src="data:image/png;base64,{inline_payload}"></body></html>',
        encoding="utf-8",
    )
    (report_root / "manifest.json").write_text(
        json.dumps(
            {
                "slug": "inline-report",
                "brand": "Inline",
                "season": "AW",
                "year": 2026,
                "entryHtml": "pages/report.html",
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ReportPackageError) as exc:
        validate_report_directory(report_root)

    assert exc.value.code == "inline_image_too_large"
