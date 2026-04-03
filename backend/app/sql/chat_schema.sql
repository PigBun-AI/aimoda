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

CREATE TRIGGER chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION chat_sessions_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
    ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_status
    ON chat_sessions(user_id, status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
    ON chat_sessions(user_id, updated_at DESC) WHERE status != 'deleted';

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
                        'trend_chart', 'collection_result', 'vision_analysis', 'other')),
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
        'trend_chart', 'collection_result', 'vision_analysis', 'other'
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

-- ── 5. style gap feedback ───────────────────────────────────────────────────
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
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    covered_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT style_gap_signals_last_session_fkey
        FOREIGN KEY (last_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
);

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
