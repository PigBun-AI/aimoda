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

DO $$
DECLARE
    existing_def TEXT;
    constraint_name TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid)
      INTO existing_def
      FROM pg_constraint c
     WHERE c.conrelid = 'report_views'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'reports'::regclass
     LIMIT 1;

    IF existing_def IS NULL OR existing_def NOT ILIKE '%ON DELETE CASCADE%' THEN
        FOR constraint_name IN
            SELECT c.conname
              FROM pg_constraint c
             WHERE c.conrelid = 'report_views'::regclass
               AND c.contype = 'f'
               AND c.confrelid = 'reports'::regclass
        LOOP
            EXECUTE format('ALTER TABLE report_views DROP CONSTRAINT IF EXISTS %I', constraint_name);
        END LOOP;

        ALTER TABLE report_views
            ADD CONSTRAINT report_views_report_id_fkey
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE;
    END IF;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_report_views_user_id ON report_views(user_id);
CREATE INDEX IF NOT EXISTS idx_report_views_user_viewed_at ON report_views(user_id, viewed_at);

COMMENT ON TABLE report_views IS
    'Tracks per-user report views for free-tier view limit enforcement.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. report_upload_jobs — Async report upload lifecycle tracking
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_upload_jobs (
    id              TEXT PRIMARY KEY,
    filename        TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    uploaded_by     INTEGER NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    source_object_key TEXT,
    report_id       INTEGER REFERENCES reports(id) ON DELETE SET NULL,
    report_slug     TEXT,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION report_upload_jobs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'report_upload_jobs' AND column_name = 'source_object_key'
    ) THEN
        ALTER TABLE report_upload_jobs ADD COLUMN source_object_key TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'report_upload_jobs_updated_at'
    ) THEN
        CREATE TRIGGER report_upload_jobs_updated_at
            BEFORE UPDATE ON report_upload_jobs
            FOR EACH ROW EXECUTE FUNCTION report_upload_jobs_set_updated_at();
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_report_upload_jobs_uploaded_by_created_at
    ON report_upload_jobs(uploaded_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_upload_jobs_status_created_at
    ON report_upload_jobs(status, created_at DESC);

COMMENT ON TABLE report_upload_jobs IS
    'Async report upload jobs for long-running OSS extraction/upload flows.';
