-- Chat Module PostgreSQL Schema
-- Run via: python -m app.sql.migrate_chat_schema
-- Or apply directly via psql: psql $POSTGRES_DSN -f app/sql/chat_schema.sql

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── 1. chat_sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         INTEGER NOT NULL,
    title           TEXT NOT NULL DEFAULT '新对话',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived', 'deleted')),
    model_config    JSONB NOT NULL DEFAULT '{}',
    message_count   INTEGER NOT NULL DEFAULT 0,
    total_tokens    BIGINT  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION chat_sessions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION chat_sessions_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
    ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_status
    ON chat_sessions(user_id, status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
    ON chat_sessions(user_id, updated_at DESC) WHERE status != 'deleted';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'chat_sessions'
          AND column_name = 'id'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE chat_sessions ALTER COLUMN id DROP DEFAULT;
        ALTER TABLE chat_sessions ALTER COLUMN id TYPE UUID USING id::uuid;
        ALTER TABLE chat_sessions ALTER COLUMN id SET DEFAULT uuid_generate_v4();
    END IF;
END $$;

-- ── 2. messages ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         JSONB NOT NULL DEFAULT '[]'::jsonb,
    token_count     INTEGER NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT messages_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'messages'
          AND column_name = 'content'
          AND data_type <> 'jsonb'
    ) THEN
        ALTER TABLE messages ALTER COLUMN content DROP DEFAULT;
        ALTER TABLE messages
            ALTER COLUMN content TYPE JSONB
            USING CASE
                WHEN content IS NULL OR btrim(content) = '' THEN '[]'::jsonb
                WHEN left(btrim(content), 1) = '[' THEN content::jsonb
                WHEN left(btrim(content), 1) = '{' THEN jsonb_build_array(content::jsonb)
                ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'text', content))
            END;
        ALTER TABLE messages ALTER COLUMN content SET DEFAULT '[]'::jsonb;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_session_created
    ON messages(session_id, created_at ASC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_session_tokens
    ON messages(session_id, token_count) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_content_gin
    ON messages USING GIN (content jsonb_path_ops);

-- ── 3. artifacts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id      UUID,
    session_id      UUID NOT NULL,
    artifact_type   TEXT NOT NULL CHECK (artifact_type IN (
                        'image', 'report', 'table', 'code', 'color_analysis',
                        'trend_chart', 'collection_result', 'bundle_result', 'vision_analysis', 'other')),
    storage_type    TEXT NOT NULL DEFAULT 's3'
                    CHECK (storage_type IN ('s3', 'local', 'database')),
    storage_path    TEXT NOT NULL DEFAULT '',
    content         TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    is_permanent    BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT artifacts_message_id_fkey
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
    CONSTRAINT artifacts_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_session_id
    ON artifacts(session_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_message_id
    ON artifacts(message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_expires_at
    ON artifacts(expires_at) WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;
ALTER TABLE artifacts
    ADD CONSTRAINT artifacts_artifact_type_check
    CHECK (artifact_type IN (
        'image', 'report', 'table', 'code', 'color_analysis',
        'trend_chart', 'collection_result', 'bundle_result', 'vision_analysis', 'other'
    ));

-- ── 4. session_context_summaries ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_context_summaries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    token_count     INTEGER NOT NULL DEFAULT 0,
    range_start     INTEGER NOT NULL,
    range_end       INTEGER NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT session_context_summaries_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    CONSTRAINT session_context_summaries_unique_version
        UNIQUE (session_id, version)
);

CREATE INDEX IF NOT EXISTS idx_context_summaries_session_version
    ON session_context_summaries(session_id, version DESC);

-- ── 5. favorite collections / taste profiles ───────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_collections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             INTEGER NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    cover_image_id      TEXT,
    cover_image_url     TEXT,
    profile_status      TEXT NOT NULL DEFAULT 'empty'
                        CHECK (profile_status IN ('empty', 'ready', 'unavailable')),
    profile_vector      JSONB,
    profile_vector_type TEXT NOT NULL DEFAULT 'fashion_clip',
    item_count          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION favorite_collections_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS favorite_collections_updated_at ON favorite_collections;
CREATE TRIGGER favorite_collections_updated_at
    BEFORE UPDATE ON favorite_collections
    FOR EACH ROW EXECUTE FUNCTION favorite_collections_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_favorite_collections_user_updated
    ON favorite_collections(user_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS favorite_collection_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id   UUID NOT NULL,
    image_id        TEXT NOT NULL,
    image_url       TEXT NOT NULL,
    brand           TEXT,
    year            INTEGER,
    quarter         TEXT,
    season          TEXT,
    gender          TEXT,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT favorite_collection_items_collection_fkey
        FOREIGN KEY (collection_id) REFERENCES favorite_collections(id) ON DELETE CASCADE,
    CONSTRAINT favorite_collection_items_unique_image
        UNIQUE (collection_id, image_id)
);

CREATE OR REPLACE FUNCTION favorite_collection_items_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS favorite_collection_items_updated_at ON favorite_collection_items;
CREATE TRIGGER favorite_collection_items_updated_at
    BEFORE UPDATE ON favorite_collection_items
    FOR EACH ROW EXECUTE FUNCTION favorite_collection_items_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_favorite_collection_items_collection_added
    ON favorite_collection_items(collection_id, added_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_favorite_collection_items_image
    ON favorite_collection_items(image_id);

ALTER TABLE favorite_collection_items
    ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'catalog';
ALTER TABLE favorite_collection_items
    ADD COLUMN IF NOT EXISTS source_ref_id TEXT;
ALTER TABLE favorite_collection_items
    ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE favorite_collection_items
    ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE favorite_collection_items
    ADD COLUMN IF NOT EXISTS embedding_vector JSONB;
ALTER TABLE favorite_collection_items
    ADD COLUMN IF NOT EXISTS embedding_vector_type TEXT NOT NULL DEFAULT 'fashion_clip';
ALTER TABLE favorite_collection_items
    ADD COLUMN IF NOT EXISTS storage_path TEXT;

UPDATE favorite_collection_items
SET source_type = 'catalog'
WHERE source_type IS NULL OR btrim(source_type) = '';

UPDATE favorite_collection_items
SET source_ref_id = image_id
WHERE source_ref_id IS NULL AND image_id IS NOT NULL;

ALTER TABLE favorite_collection_items
    ALTER COLUMN source_ref_id SET NOT NULL;

ALTER TABLE favorite_collection_items
    DROP CONSTRAINT IF EXISTS favorite_collection_items_source_type_check;
ALTER TABLE favorite_collection_items
    ADD CONSTRAINT favorite_collection_items_source_type_check
    CHECK (source_type IN ('catalog', 'upload'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_collection_items_collection_source_ref
    ON favorite_collection_items(collection_id, source_type, source_ref_id);

CREATE TABLE IF NOT EXISTS favorite_collection_upload_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id   UUID NOT NULL,
    user_id         INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'uploading', 'queued', 'processing', 'completed', 'partial_failed', 'failed')),
    total_count     INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    CONSTRAINT favorite_collection_upload_jobs_collection_fkey
        FOREIGN KEY (collection_id) REFERENCES favorite_collections(id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION favorite_collection_upload_jobs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS favorite_collection_upload_jobs_updated_at ON favorite_collection_upload_jobs;
CREATE TRIGGER favorite_collection_upload_jobs_updated_at
    BEFORE UPDATE ON favorite_collection_upload_jobs
    FOR EACH ROW EXECUTE FUNCTION favorite_collection_upload_jobs_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_favorite_collection_upload_jobs_collection_created
    ON favorite_collection_upload_jobs(collection_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_favorite_collection_upload_jobs_user_status
    ON favorite_collection_upload_jobs(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS favorite_collection_upload_job_items (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id                  UUID NOT NULL,
    collection_id           UUID NOT NULL,
    filename                TEXT NOT NULL,
    content_type            TEXT NOT NULL,
    file_size_bytes         BIGINT NOT NULL DEFAULT 0,
    object_key              TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'uploaded', 'upload_failed', 'processing', 'completed', 'failed')),
    sort_order              INTEGER NOT NULL DEFAULT 0,
    error_message           TEXT,
    favorite_item_image_id  TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at              TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    CONSTRAINT favorite_collection_upload_job_items_job_fkey
        FOREIGN KEY (job_id) REFERENCES favorite_collection_upload_jobs(id) ON DELETE CASCADE,
    CONSTRAINT favorite_collection_upload_job_items_collection_fkey
        FOREIGN KEY (collection_id) REFERENCES favorite_collections(id) ON DELETE CASCADE,
    CONSTRAINT favorite_collection_upload_job_items_unique_object_key
        UNIQUE (job_id, object_key)
);

CREATE OR REPLACE FUNCTION favorite_collection_upload_job_items_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS favorite_collection_upload_job_items_updated_at ON favorite_collection_upload_job_items;
CREATE TRIGGER favorite_collection_upload_job_items_updated_at
    BEFORE UPDATE ON favorite_collection_upload_job_items
    FOR EACH ROW EXECUTE FUNCTION favorite_collection_upload_job_items_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_favorite_collection_upload_job_items_job_sort
    ON favorite_collection_upload_job_items(job_id, sort_order ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_favorite_collection_upload_job_items_job_status
    ON favorite_collection_upload_job_items(job_id, status, sort_order ASC);

-- ── 6. style gap feedback ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS style_gap_signals (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_normalized  TEXT NOT NULL UNIQUE,
    latest_query_raw  TEXT NOT NULL,
    source            TEXT NOT NULL DEFAULT 'agent_auto',
    trigger_tool      TEXT NOT NULL DEFAULT 'search_style',
    search_stage      TEXT NOT NULL DEFAULT 'not_found',
    status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'covered', 'ignored')),
    total_hits        INTEGER NOT NULL DEFAULT 1,
    unique_sessions   INTEGER NOT NULL DEFAULT 0,
    last_session_id   UUID,
    last_user_id      INTEGER,
    latest_context    JSONB NOT NULL DEFAULT '{}'::jsonb,
    linked_style_name TEXT,
    resolution_note   TEXT NOT NULL DEFAULT '',
    resolved_by       TEXT NOT NULL DEFAULT '',
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    covered_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT style_gap_signals_last_session_fkey
        FOREIGN KEY (last_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
);

ALTER TABLE style_gap_signals
    ADD COLUMN IF NOT EXISTS linked_style_name TEXT;
ALTER TABLE style_gap_signals
    ADD COLUMN IF NOT EXISTS resolution_note TEXT NOT NULL DEFAULT '';
ALTER TABLE style_gap_signals
    ADD COLUMN IF NOT EXISTS resolved_by TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION style_gap_signals_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS style_gap_signals_updated_at ON style_gap_signals;
CREATE TRIGGER style_gap_signals_updated_at
    BEFORE UPDATE ON style_gap_signals
    FOR EACH ROW EXECUTE FUNCTION style_gap_signals_set_updated_at();

CREATE TABLE IF NOT EXISTS style_gap_events (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signal_id         UUID NOT NULL,
    query_raw         TEXT NOT NULL,
    query_normalized  TEXT NOT NULL,
    session_id        UUID,
    user_id           INTEGER,
    source            TEXT NOT NULL DEFAULT 'agent_auto',
    trigger_tool      TEXT NOT NULL DEFAULT 'search_style',
    search_stage      TEXT NOT NULL DEFAULT 'not_found',
    context           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT style_gap_events_signal_fkey
        FOREIGN KEY (signal_id) REFERENCES style_gap_signals(id) ON DELETE CASCADE,
    CONSTRAINT style_gap_events_session_fkey
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_style_gap_events_session_query_tool
    ON style_gap_events(query_normalized, session_id, trigger_tool)
    WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_style_gap_signals_status_seen
    ON style_gap_signals(status, total_hits DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_style_gap_events_signal_created
    ON style_gap_events(signal_id, created_at DESC);
