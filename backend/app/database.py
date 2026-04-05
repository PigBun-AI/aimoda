import os
import sqlite3
from pathlib import Path

import bcrypt
import fcntl

from .config import settings

_db: sqlite3.Connection | None = None


def get_db() -> sqlite3.Connection:
    """Get the singleton SQLite connection."""
    global _db
    if _db is None:
        db_path = settings.resolved_database_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _db = sqlite3.connect(str(db_path), check_same_thread=False, timeout=30)
        _db.row_factory = sqlite3.Row
        _db.execute("PRAGMA journal_mode = WAL")
        _db.execute("PRAGMA foreign_keys = ON")
        _db.execute("PRAGMA busy_timeout = 30000")
    return _db


# ---------- Migrations ----------

_MIGRATIONS = [
    """
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      brand TEXT NOT NULL,
      season TEXT NOT NULL,
      year INTEGER NOT NULL,
      look_count INTEGER NOT NULL,
      path TEXT NOT NULL,
      uploaded_by INTEGER NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );
    """,
    """
    CREATE TRIGGER IF NOT EXISTS users_set_updated_at
    AFTER UPDATE ON users
    BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS reports_set_updated_at
    AFTER UPDATE ON reports
    BEGIN
      UPDATE reports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
    """,
    """
    CREATE TABLE IF NOT EXISTS redemption_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('1week', '1month', '3months', '1year')),
      status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'expired')),
      created_by INTEGER NOT NULL,
      used_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_at TEXT,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (used_by) REFERENCES users(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      source_code_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (source_code_id) REFERENCES redemption_codes(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('login', 'view_report', 'redeem_code', 'upload_report')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON user_activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_user_action ON user_activity_logs(user_id, action);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_redemption_codes_status ON redemption_codes(status);
    """,
    # 报告查看记录表
    """
    CREATE TABLE IF NOT EXISTS report_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      report_id INTEGER NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
      UNIQUE (user_id, report_id)
    );
    """,
    # 会话表
    """
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      device_info TEXT,
      ip_address TEXT,
      user_agent TEXT,
      last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """,
    # 报告查看索引
    """
    CREATE INDEX IF NOT EXISTS idx_report_views_user_id ON report_views(user_id);
    CREATE INDEX IF NOT EXISTS idx_report_views_user_viewed_at ON report_views(user_id, viewed_at);
    """,
    # 会话表索引
    """
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_last_active ON sessions(user_id, last_active_at);
    """,
    # reports.uploaded_by → ON DELETE SET NULL
    """
    CREATE TABLE IF NOT EXISTS reports_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      brand TEXT NOT NULL,
      season TEXT NOT NULL,
      year INTEGER NOT NULL,
      look_count INTEGER NOT NULL,
      path TEXT NOT NULL,
      uploaded_by INTEGER,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );
    INSERT OR IGNORE INTO reports_new SELECT * FROM reports;
    DROP TABLE IF EXISTS reports;
    ALTER TABLE reports_new RENAME TO reports;

    CREATE TRIGGER IF NOT EXISTS reports_set_updated_at
    AFTER UPDATE ON reports
    BEGIN
      UPDATE reports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
    """,
    # report_views → 移除 report_id 的 ON DELETE CASCADE
    """
    CREATE TABLE IF NOT EXISTS report_views_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      report_id INTEGER NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (user_id, report_id)
    );
    INSERT OR IGNORE INTO report_views_new SELECT * FROM report_views;
    DROP TABLE IF EXISTS report_views;
    ALTER TABLE report_views_new RENAME TO report_views;

    CREATE INDEX IF NOT EXISTS idx_report_views_user_id ON report_views(user_id);
    CREATE INDEX IF NOT EXISTS idx_report_views_user_viewed_at ON report_views(user_id, viewed_at);
    """,
]

DEFAULT_ADMIN_EMAIL = "admin@fashion-report.local"
DEFAULT_ADMIN_PASSWORD = "ChangeMe123!"


def run_migrations() -> None:
    db = get_db()
    for statement in _MIGRATIONS:
        db.executescript(statement)
    _run_incremental_migrations(db)
    db.commit()


def _table_columns(db: sqlite3.Connection, table: str) -> set[str]:
    rows = db.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"] for row in rows}


def _table_info(db: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    return db.execute(f"PRAGMA table_info({table})").fetchall()


def _rebuild_users_table_for_phone_auth(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        PRAGMA foreign_keys = OFF;

        ALTER TABLE users RENAME TO users_legacy;

        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE,
          password_hash TEXT,
          role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          phone TEXT,
          phone_verified_at TEXT
        );

        INSERT INTO users (id, email, password_hash, role, created_at, updated_at, phone, phone_verified_at)
        SELECT id, email, password_hash, role, created_at, updated_at, phone, phone_verified_at
        FROM users_legacy;

        DROP TABLE users_legacy;

        CREATE TRIGGER IF NOT EXISTS users_set_updated_at
        AFTER UPDATE ON users
        BEGIN
          UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
          ON users(phone) WHERE phone IS NOT NULL;

        PRAGMA foreign_keys = ON;
        """
    )


def _rebuild_sms_codes_table_for_register_flow(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        PRAGMA foreign_keys = OFF;

        ALTER TABLE sms_verification_codes RENAME TO sms_verification_codes_legacy;

        CREATE TABLE sms_verification_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'register')),
          code_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          send_count INTEGER NOT NULL DEFAULT 1,
          ip_address TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO sms_verification_codes (id, phone, purpose, code_hash, expires_at, consumed_at, send_count, ip_address, created_at)
        SELECT id, phone, purpose, code_hash, expires_at, consumed_at, send_count, ip_address, created_at
        FROM sms_verification_codes_legacy;

        DROP TABLE sms_verification_codes_legacy;

        CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_created
          ON sms_verification_codes(phone, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_purpose
          ON sms_verification_codes(phone, purpose, created_at DESC);

        PRAGMA foreign_keys = ON;
        """
    )


def _has_foreign_key_target(db: sqlite3.Connection, table: str, target: str) -> bool:
    rows = db.execute(f"PRAGMA foreign_key_list({table})").fetchall()
    return any(row["table"] == target for row in rows)


def _rebuild_legacy_user_foreign_keys(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        PRAGMA foreign_keys = OFF;

        ALTER TABLE sessions RENAME TO sessions_legacy;
        CREATE TABLE sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          refresh_token_hash TEXT NOT NULL UNIQUE,
          device_info TEXT,
          ip_address TEXT,
          user_agent TEXT,
          last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO sessions (id, user_id, refresh_token_hash, device_info, ip_address, user_agent, last_active_at, expires_at, created_at)
        SELECT id, user_id, refresh_token_hash, device_info, ip_address, user_agent, last_active_at, expires_at, created_at
        FROM sessions_legacy;
        DROP TABLE sessions_legacy;
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_user_last_active ON sessions(user_id, last_active_at);

        ALTER TABLE redemption_codes RENAME TO redemption_codes_legacy;
        CREATE TABLE redemption_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK (type IN ('1week', '1month', '3months', '1year')),
          status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'expired')),
          created_by INTEGER NOT NULL,
          used_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          used_at TEXT,
          expires_at TEXT NOT NULL,
          FOREIGN KEY (created_by) REFERENCES users(id),
          FOREIGN KEY (used_by) REFERENCES users(id)
        );
        INSERT INTO redemption_codes (id, code, type, status, created_by, used_by, created_at, used_at, expires_at)
        SELECT id, code, type, status, created_by, used_by, created_at, used_at, expires_at
        FROM redemption_codes_legacy;
        DROP TABLE redemption_codes_legacy;
        CREATE INDEX IF NOT EXISTS idx_redemption_codes_status ON redemption_codes(status);

        ALTER TABLE subscriptions RENAME TO subscriptions_legacy;
        CREATE TABLE subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          source_code_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (source_code_id) REFERENCES redemption_codes(id)
        );
        INSERT INTO subscriptions (id, user_id, starts_at, ends_at, source_code_id, status, created_at)
        SELECT id, user_id, starts_at, ends_at, source_code_id, status, created_at
        FROM subscriptions_legacy;
        DROP TABLE subscriptions_legacy;
        CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);

        ALTER TABLE user_activity_logs RENAME TO user_activity_logs_legacy;
        CREATE TABLE user_activity_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('login', 'view_report', 'redeem_code', 'upload_report')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        INSERT INTO user_activity_logs (id, user_id, action, created_at)
        SELECT id, user_id, action, created_at
        FROM user_activity_logs_legacy;
        DROP TABLE user_activity_logs_legacy;
        CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON user_activity_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_activity_logs_user_action ON user_activity_logs(user_id, action);

        PRAGMA foreign_keys = ON;
        """
    )


def _run_incremental_migrations(db: sqlite3.Connection) -> None:
    user_columns = _table_columns(db, "users")
    if "phone" not in user_columns:
        db.execute("ALTER TABLE users ADD COLUMN phone TEXT")
    if "phone_verified_at" not in user_columns:
        db.execute("ALTER TABLE users ADD COLUMN phone_verified_at TEXT")

    user_info = {row["name"]: row for row in _table_info(db, "users")}
    email_column = user_info.get("email")
    password_column = user_info.get("password_hash")
    if (email_column and email_column["notnull"]) or (password_column and password_column["notnull"]):
        _rebuild_users_table_for_phone_auth(db)
    if _has_foreign_key_target(db, "sessions", "users_legacy"):
        _rebuild_legacy_user_foreign_keys(db)

    db.executescript(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
          ON users(phone) WHERE phone IS NOT NULL;

        CREATE TABLE IF NOT EXISTS sms_verification_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'register')),
          code_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          send_count INTEGER NOT NULL DEFAULT 1,
          ip_address TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_created
          ON sms_verification_codes(phone, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_purpose
          ON sms_verification_codes(phone, purpose, created_at DESC);

        CREATE TABLE IF NOT EXISTS feature_usage_counters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          feature_code TEXT NOT NULL CHECK (feature_code IN (
            'ai_chat', 'fashion_reports', 'inspiration', 'image_generation', 'video_generation'
          )),
          period_type TEXT NOT NULL CHECK (period_type IN ('lifetime', 'daily')),
          period_key TEXT NOT NULL,
          used_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE (user_id, feature_code, period_type, period_key)
        );

        CREATE INDEX IF NOT EXISTS idx_feature_usage_user_feature
          ON feature_usage_counters(user_id, feature_code, period_type, period_key);

        CREATE TABLE IF NOT EXISTS feature_usage_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          feature_code TEXT NOT NULL CHECK (feature_code IN (
            'ai_chat', 'fashion_reports', 'inspiration', 'image_generation', 'video_generation'
          )),
          period_type TEXT NOT NULL CHECK (period_type IN ('lifetime', 'daily')),
          period_key TEXT NOT NULL,
          delta INTEGER NOT NULL DEFAULT 1,
          metadata_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_feature_usage_events_user_feature
          ON feature_usage_events(user_id, feature_code, created_at DESC);
        """
    )

    sms_table_sql_row = db.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sms_verification_codes'"
    ).fetchone()
    sms_table_sql = (sms_table_sql_row["sql"] if sms_table_sql_row else "") or ""
    if "register" not in sms_table_sql:
        _rebuild_sms_codes_table_for_register_flow(db)


def bootstrap_admin_user() -> None:
    db = get_db()
    row = db.execute(
        "SELECT id FROM users WHERE email = ?", (DEFAULT_ADMIN_EMAIL,)
    ).fetchone()
    if row:
        return

    password_hash = bcrypt.hashpw(
        DEFAULT_ADMIN_PASSWORD.encode(), bcrypt.gensalt()
    ).decode()
    db.execute(
        "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)",
        (DEFAULT_ADMIN_EMAIL, password_hash, "admin"),
    )
    db.commit()


def initialize_database() -> None:
    lock_path = settings.resolved_database_path.with_suffix(".init.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    with open(lock_path, "w", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            run_migrations()
            bootstrap_admin_user()
            lock_file.flush()
            os.fsync(lock_file.fileno())
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
