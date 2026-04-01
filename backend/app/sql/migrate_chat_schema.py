"""
PostgreSQL Chat Schema Migration

Updates chat_service.py to use the new PostgreSQL schema with:
  - Enhanced chat_sessions table
  - messages table
  - artifacts table
  - session_context_summaries table

Run: python -m app.sql.migrate_chat_schema
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

import psycopg

from ..config import settings


def get_pg_conn():
    return psycopg.connect(settings.POSTGRES_DSN)


def run_migration():
    """Apply the enhanced chat schema to PostgreSQL."""
    schema_sql = """
    -- Extensions
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";

    -- ── 1. chat_sessions ──
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

    -- ── 2. messages ──
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

    -- ── 3. artifacts ──
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

    -- ── 4. session_context_summaries ──
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
    """

    with get_pg_conn() as conn:
        conn.execute(schema_sql)
        conn.commit()
    print("Chat schema migration applied successfully.")


def migrate_existing_content_to_jsonb():
    """Migrate existing TEXT content in messages to JSONB array format.

    Old format: content = 'Hello world'
    New format: content = [{"type": "text", "text": "Hello world"}]

    Only migrates rows where content is still TEXT (not already JSONB array).
    """
    with get_pg_conn() as conn:
        # Migrate TEXT content to JSONB array
        migrated = conn.execute("""
            UPDATE messages
            SET content = CASE
                WHEN jsonb_typeof(content) IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(content) = 'string' THEN
                    to_jsonb(ARRAY[jsonb_build_object('type', 'text', 'text', content)])
                ELSE content
            END
            WHERE jsonb_typeof(content) IS NULL
               OR jsonb_typeof(content) = 'string'
        """).rowcount
        conn.commit()
    print(f"Migrated {migrated} rows from TEXT to JSONB content format.")
    return migrated


def cleanup_expired_artifacts() -> int:
    """Delete artifacts past their expires_at."""
    with get_pg_conn() as conn:
        result = conn.execute(
            "SELECT cleanup_expired_artifacts()"
        ).fetchone()
    return result[0] if result else 0


if __name__ == "__main__":
    run_migration()
    migrate_existing_content_to_jsonb()
