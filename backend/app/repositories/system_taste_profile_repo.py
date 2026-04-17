from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from ..postgres import pg_connection


SYSTEM_TASTE_PROFILE_KEY = "aimoda_system_dna"


def _serialize_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "key": row.get("key"),
        "source_type": row.get("source_type") or "brand_curation",
        "profile_status": row.get("profile_status") or "empty",
        "profile_vector": row.get("profile_vector"),
        "profile_vector_type": row.get("profile_vector_type") or "fashion_clip",
        "metadata": row.get("metadata") or {},
        "created_at": row.get("created_at").isoformat() if row.get("created_at") is not None else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") is not None else None,
    }


def get_system_taste_profile(key: str = SYSTEM_TASTE_PROFILE_KEY) -> dict[str, Any] | None:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT key, source_type, profile_status, profile_vector, profile_vector_type, metadata, created_at, updated_at
                FROM system_taste_profiles
                WHERE key = %s
                LIMIT 1
                """,
                [key],
            )
            row = cur.fetchone()
    return _serialize_row(dict(row)) if row else None


def upsert_system_taste_profile(
    *,
    key: str = SYSTEM_TASTE_PROFILE_KEY,
    source_type: str = "brand_curation",
    profile_status: str,
    profile_vector: list[float] | None,
    profile_vector_type: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO system_taste_profiles (
                    key,
                    source_type,
                    profile_status,
                    profile_vector,
                    profile_vector_type,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (key) DO UPDATE
                SET source_type = EXCLUDED.source_type,
                    profile_status = EXCLUDED.profile_status,
                    profile_vector = EXCLUDED.profile_vector,
                    profile_vector_type = EXCLUDED.profile_vector_type,
                    metadata = EXCLUDED.metadata
                RETURNING key, source_type, profile_status, profile_vector, profile_vector_type, metadata, created_at, updated_at
                """,
                [
                    key,
                    source_type,
                    profile_status,
                    Jsonb(profile_vector) if profile_vector is not None else None,
                    profile_vector_type,
                    Jsonb(metadata or {}),
                ],
            )
            row = cur.fetchone()
            conn.commit()
    if not row:
        raise RuntimeError("failed to upsert system taste profile")
    return _serialize_row(dict(row)) or {}
