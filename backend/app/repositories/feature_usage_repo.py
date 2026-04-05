import json

from ..database import get_db
from ..models import FeatureUsageRecord


def _map_usage(row) -> FeatureUsageRecord:
    return FeatureUsageRecord(
        id=row["id"],
        user_id=row["user_id"],
        feature_code=row["feature_code"],
        period_type=row["period_type"],
        period_key=row["period_key"],
        used_count=row["used_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def get_feature_usage(user_id: int, feature_code: str, period_type: str, period_key: str) -> FeatureUsageRecord | None:
    db = get_db()
    row = db.execute(
        """
        SELECT *
        FROM feature_usage_counters
        WHERE user_id = ? AND feature_code = ? AND period_type = ? AND period_key = ?
        """,
        (user_id, feature_code, period_type, period_key),
    ).fetchone()
    return _map_usage(row) if row else None


def increment_feature_usage(
    *,
    user_id: int,
    feature_code: str,
    period_type: str,
    period_key: str,
    delta: int = 1,
    metadata: dict | None = None,
) -> FeatureUsageRecord:
    db = get_db()
    db.execute(
        """
        INSERT INTO feature_usage_counters (user_id, feature_code, period_type, period_key, used_count)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, feature_code, period_type, period_key)
        DO UPDATE SET
          used_count = feature_usage_counters.used_count + excluded.used_count,
          updated_at = CURRENT_TIMESTAMP
        """,
        (user_id, feature_code, period_type, period_key, delta),
    )
    db.execute(
        """
        INSERT INTO feature_usage_events (user_id, feature_code, period_type, period_key, delta, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, feature_code, period_type, period_key, delta, json.dumps(metadata or {})),
    )
    db.commit()
    return get_feature_usage(user_id, feature_code, period_type, period_key)  # type: ignore[return-value]
