from __future__ import annotations

import argparse
import sys

from app.repositories.report_repo import list_all_reports, update_report_cover_url
from app.services.report_cover_service import generate_report_cover


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backfill 16:9 generated cover images for uploaded reports.",
    )
    parser.add_argument(
        "--slug",
        action="append",
        default=[],
        help="Only backfill these slugs. Can be passed multiple times.",
    )
    parser.add_argument(
        "--report-id",
        action="append",
        type=int,
        default=[],
        help="Only backfill these report IDs. Can be passed multiple times.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Only process the first N matching reports.",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Only backfill reports whose cover_url is empty.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate even if cover_url already exists.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be processed without writing changes.",
    )
    return parser


def _should_process(report, args: argparse.Namespace) -> bool:
    if args.slug and report.slug not in set(args.slug):
        return False
    if args.report_id and report.id not in set(args.report_id):
        return False
    if args.only_missing and report.cover_url:
        return False
    if not args.force and not args.only_missing and report.cover_url:
        return False
    return True


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    reports = [report for report in list_all_reports() if _should_process(report, args)]
    if args.limit > 0:
        reports = reports[: args.limit]

    if not reports:
        print("No matching reports to backfill.")
        return 0

    updated = 0
    failed = 0

    for report in reports:
        print(f"Processing report #{report.id} {report.slug} ...")
        if args.dry_run:
            continue

        cover_url = generate_report_cover(report.index_url, report.slug)
        if not cover_url:
            print(f"  FAILED: cover generation returned empty for {report.slug}")
            failed += 1
            continue

        saved = update_report_cover_url(report.id, cover_url)
        if not saved:
            print(f"  FAILED: report disappeared before update: {report.slug}")
            failed += 1
            continue

        updated += 1
        print(f"  OK: {cover_url}")

    print(f"Backfill finished. updated={updated} failed={failed} total={len(reports)}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
