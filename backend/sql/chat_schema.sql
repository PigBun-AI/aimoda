-- ============================================================================
-- Fashion Report Chat — PostgreSQL Schema
-- PostgreSQL 16+ (uses JSONB, pg_trgm, partitioned tables)
--
-- Database: fashion_chat
-- User: fashion
--
-- Tables:
--   1. chat_sessions       — Session metadata (enhanced)
--   2. messages             — Individual chat messages
--   3. artifacts            — Long-running task outputs (images, reports, tables)
--   4. session_context_summaries — Sliding window summaries for context reduction
--
-- Dependencies:
--   - LangGraph checkpoint tables (managed separately by AsyncPostgresSaver)
--   - SQLite users table (FK via user_id INTEGER, NOT enforced at PG level)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for future full-text search

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. chat_sessions — Enhanced session metadata
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Ownership (FK to SQLite users table; NOT enforced via PG constraint
    -- since auth/users live in a separate SQLite DB)
    user_id         INTEGER NOT NULL,

    -- Session info
    title           TEXT NOT NULL DEFAULT '新对话',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived', 'deleted')),

    -- Model & parameters used (JSONB so schema can evolve)
    model_config    JSONB NOT NULL DEFAULT '{}',

    -- Pagination / ordering helpers
    message_count   INTEGER NOT NULL DEFAULT 0,
    total_tokens    BIGINT  NOT NULL DEFAULT 0,

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,   -- soft delete

    -- Constraints & indexes
    CONSTRAINT chat_sessions_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION chat_sessions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION chat_sessions_set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
    ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_status
    ON chat_sessions(user_id, status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
    ON chat_sessions(user_id, updated_at DESC) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at
    ON chat_sessions(created_at);

COMMENT ON TABLE chat_sessions IS
    'Chat session metadata. FK to SQLite users(id). LangGraph state lives in checkpoint tables.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. messages — Individual messages in a session
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Session reference
    session_id      UUID NOT NULL,

    -- Sender role
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),

    -- Content
    content         TEXT NOT NULL DEFAULT '',

    -- Token cache (avoid recalculating on every query)
    token_count     INTEGER NOT NULL DEFAULT 0,

    -- Flexible metadata: tool calls, image URLs, function arguments, etc.
    metadata        JSONB NOT NULL DEFAULT '{}',

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Soft delete (cascade from session)
    deleted_at      TIMESTAMPTZ,

    -- Constraints & indexes
    CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id)
        REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- Indexes for efficient retrieval and sliding window
CREATE INDEX IF NOT EXISTS idx_messages_session_created
    ON messages(session_id, created_at ASC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_session_tokens
    ON messages(session_id, token_count) WHERE deleted_at IS NULL;

-- Partial index: find sessions with messages
CREATE INDEX IF NOT EXISTS idx_messages_has_content
    ON messages(session_id) WHERE deleted_at IS NULL AND content != '';

COMMENT ON TABLE messages IS
    'Individual chat messages. LangGraph also persists full state in checkpoint tables.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. artifacts — Long-running task outputs (images, reports, tables, code)
-- ─────────────────────────────────────────────────────────────────────────────

-- Artifact type enumeration (implemented as a CHECK, not a real enum, for flexibility)
CREATE TABLE IF NOT EXISTS artifacts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Optional message/session linkage (can exist without a message, e.g. async generation)
    message_id      UUID,
    session_id       UUID NOT NULL,

    -- Artifact classification
    artifact_type   TEXT NOT NULL CHECK (artifact_type IN (
                        'image', 'report', 'table', 'code', 'color_analysis',
                        'trend_chart', 'collection_result', 'vision_analysis', 'other'
                    )),

    -- Storage location
    storage_type    TEXT NOT NULL DEFAULT 's3'
                    CHECK (storage_type IN ('s3', 'local', 'database')),
    storage_path    TEXT NOT NULL DEFAULT '',   -- S3 key, file path, or empty

    -- Content (inline for small artifacts, e.g. JSON tables, code snippets)
    content         TEXT,

    -- File metadata
    metadata        JSONB NOT NULL DEFAULT '{}',  -- size_bytes, mime_type, dimensions, etc.

    -- Retention policy
    is_permanent    BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ,                  -- NULL = never expires

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Soft delete
    deleted_at      TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT artifacts_message_id_fkey FOREIGN KEY (message_id)
        REFERENCES messages(id) ON DELETE SET NULL,
    CONSTRAINT artifacts_session_id_fkey FOREIGN KEY (session_id)
        REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_artifacts_session_id
    ON artifacts(session_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_message_id
    ON artifacts(message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_type
    ON artifacts(artifact_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_expires_at
    ON artifacts(expires_at) WHERE deleted_at IS NULL AND expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_storage_path
    ON artifacts(storage_path) WHERE storage_path != '';

-- Partial: permanent artifacts (keep indexed)
CREATE INDEX IF NOT EXISTS idx_artifacts_permanent
    ON artifacts(session_id, created_at DESC) WHERE deleted_at IS NULL AND is_permanent = TRUE;

COMMENT ON TABLE artifacts IS
    'Outputs from long-running tasks (tool calls, generated reports, charts, etc.).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. session_context_summaries — Summaries for sliding window optimization
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_context_summaries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Session reference (one summary per session, but versioned)
    session_id      UUID NOT NULL,

    -- Summary content
    summary         TEXT NOT NULL DEFAULT '',
    token_count     INTEGER NOT NULL DEFAULT 0,

    -- The message range this summary covers (inclusive)
    range_start     INTEGER NOT NULL,
    range_end       INTEGER NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,  -- monotonically increasing

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints & indexes
    CONSTRAINT session_context_summaries_session_id_fkey FOREIGN KEY (session_id)
        REFERENCES chat_sessions(id) ON DELETE CASCADE,

    -- One active summary per version per session
    CONSTRAINT session_context_summaries_unique_version
        UNIQUE (session_id, version)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_context_summaries_session_version
    ON session_context_summaries(session_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_context_summaries_token_count
    ON session_context_summaries(token_count);

COMMENT ON TABLE session_context_summaries IS
    'AI-generated summaries of message ranges for context window sliding window optimization.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Maintenance: TTL cleanup for expired artifacts (run via pg_cron or cron)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_expired_artifacts()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    WITH deleted AS (
        DELETE FROM artifacts
        WHERE expires_at IS NOT NULL
          AND expires_at < NOW()
          AND deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Example: schedule cleanup daily at 3am (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-artifacts', '0 3 * * *', $$SELECT cleanup_expired_artifacts()$$);

COMMENT ON FUNCTION cleanup_expired_artifacts() IS
    'Deletes artifacts past their expires_at. Run via pg_cron or external cron.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Maintenance: vacuum old soft-deleted records (run weekly)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vacuum_soft_deleted_records()
RETURNS TABLE(table_name TEXT, deleted_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    WITH d1 AS (
        DELETE FROM chat_sessions WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'
        RETURNING id
    ),
    d2 AS (
        DELETE FROM messages WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'
        RETURNING id
    ),
    d3 AS (
        DELETE FROM artifacts WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'
        RETURNING id
    )
    SELECT 'chat_sessions'::TEXT, COUNT(*)::BIGINT FROM d1
    UNION ALL
    SELECT 'messages'::TEXT, COUNT(*)::BIGINT FROM d2
    UNION ALL
    SELECT 'artifacts'::TEXT, COUNT(*)::BIGINT FROM d3;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION vacuum_soft_deleted_records() IS
    'Permanently removes records soft-deleted > 30 days ago. Run weekly.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Sample data for testing (optional — comment out in production)
-- ─────────────────────────────────────────────────────────────────────────────

-- -- Create a test session (requires a user with id=1 in SQLite users table)
-- INSERT INTO chat_sessions (id, user_id, title, model_config)
-- VALUES (
--     '550e8400-e29b-41d4-a716-446655440000'::UUID,
--     1,
--     'Test Session',
--     '{"model": "MiniMax-M2.5-highspeed", "temperature": 0.1}'::JSONB
-- );
--
-- -- Add a test message
-- INSERT INTO messages (session_id, role, content, token_count, metadata)
-- VALUES (
--     '550e8400-e29b-41d4-a716-446655440000'::UUID,
--     'user',
--     '找一件黑色的连衣裙',
--     12,
--     '{"language": "zh"}'::JSONB
-- );
