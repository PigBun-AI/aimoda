-- ============================================================================
-- Fashion Report — Report Storage PostgreSQL Schema
-- Migrated from SQLite to PostgreSQL (shared fashion_chat database)
--
-- Tables:
--   1. reports       — Report metadata + OSS URLs
--   2. report_views  — Per-user view tracking (free tier limit)
--
-- Note: users table remains in SQLite; user_id FKs are NOT enforced here.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. reports — Report metadata with OSS storage
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reports (
    id              SERIAL PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    brand           TEXT NOT NULL,
    season          TEXT NOT NULL,
    year            INTEGER NOT NULL,
    look_count      INTEGER NOT NULL DEFAULT 0,

    -- OSS URLs (replacing filesystem path)
    index_url       TEXT NOT NULL DEFAULT '',     -- OSS URL for index.html
    overview_url    TEXT,                          -- OSS URL for overview.html (optional)
    cover_url       TEXT,                          -- OSS URL for cover image
    oss_prefix      TEXT NOT NULL DEFAULT '',      -- OSS path prefix, e.g. "reports/zimmermann-fall-2026/"

    -- Ownership (FK to SQLite users table; NOT enforced via PG constraint)
    uploaded_by     INTEGER,

    -- Flexible metadata
    metadata_json   JSONB,

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION reports_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'reports_updated_at'
    ) THEN
        CREATE TRIGGER reports_updated_at
            BEFORE UPDATE ON reports
            FOR EACH ROW EXECUTE FUNCTION reports_set_updated_at();
    END IF;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reports_brand ON reports(brand);
CREATE INDEX IF NOT EXISTS idx_reports_season_year ON reports(season, year);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);

COMMENT ON TABLE reports IS
    'Fashion report metadata with OSS storage URLs. Migrated from SQLite.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. report_views — Track which reports each user has viewed (free tier limit)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_views (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL,              -- FK to SQLite users(id), NOT enforced
    report_id       INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    viewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, report_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_report_views_user_id ON report_views(user_id);
CREATE INDEX IF NOT EXISTS idx_report_views_user_viewed_at ON report_views(user_id, viewed_at);

COMMENT ON TABLE report_views IS
    'Tracks per-user report views for free-tier view limit enforcement.';
