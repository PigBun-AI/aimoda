from ..database import get_db
from ..models import ReportRecord, ReportMetadata


def _map_report(row) -> ReportRecord:
    return ReportRecord(
        id=row["id"],
        slug=row["slug"],
        title=row["title"],
        brand=row["brand"],
        season=row["season"],
        year=row["year"],
        look_count=row["look_count"],
        path=row["path"],
        uploaded_by=row["uploaded_by"],
        metadata_json=row["metadata_json"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def find_report_by_slug(slug: str) -> ReportRecord | None:
    db = get_db()
    row = db.execute("SELECT * FROM reports WHERE slug = ?", (slug,)).fetchone()
    return _map_report(row) if row else None


def find_report_by_id(report_id: int) -> ReportRecord | None:
    db = get_db()
    row = db.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    return _map_report(row) if row else None


def list_reports(page: int = 1, limit: int = 12) -> tuple[list[ReportRecord], int]:
    db = get_db()
    offset = (page - 1) * limit
    count_row = db.execute("SELECT COUNT(*) as total FROM reports").fetchone()
    total = count_row["total"]
    rows = db.execute(
        "SELECT * FROM reports ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)
    ).fetchall()
    return [_map_report(r) for r in rows], total


def delete_report_by_id(report_id: int) -> bool:
    db = get_db()
    cursor = db.execute("DELETE FROM reports WHERE id = ?", (report_id,))
    db.commit()
    return cursor.rowcount > 0


def create_report(
    slug: str,
    title: str,
    brand: str,
    season: str,
    year: int,
    look_count: int,
    path: str,
    uploaded_by: int,
    metadata_json: str | None,
) -> ReportRecord:
    db = get_db()
    cursor = db.execute(
        """INSERT INTO reports (slug, title, brand, season, year, look_count, path, uploaded_by, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (slug, title, brand, season, year, look_count, path, uploaded_by, metadata_json),
    )
    db.commit()
    row = db.execute("SELECT * FROM reports WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _map_report(row)
