import { db } from './client.js'

const migrations = [
  `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `,
  `
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
  `,
  `
    CREATE TRIGGER IF NOT EXISTS users_set_updated_at
    AFTER UPDATE ON users
    BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `,
  `
    CREATE TRIGGER IF NOT EXISTS reports_set_updated_at
    AFTER UPDATE ON reports
    BEGIN
      UPDATE reports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `,
  `
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
  `,
  `
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
  `,
  `
    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('login', 'view_report', 'redeem_code', 'upload_report')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON user_activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_user_action ON user_activity_logs(user_id, action);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_redemption_codes_status ON redemption_codes(status);
  `,
  // 报告查看记录表 - 追踪免费用户的报告查看次数
  `
    CREATE TABLE IF NOT EXISTS report_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      report_id INTEGER NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
      UNIQUE (user_id, report_id)
    );
  `,
  // 会话表 - 支持单点登录控制
  `
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
  `,
  // 报告查看记录索引
  `
    CREATE INDEX IF NOT EXISTS idx_report_views_user_id ON report_views(user_id);
    CREATE INDEX IF NOT EXISTS idx_report_views_user_viewed_at ON report_views(user_id, viewed_at);
  `,
  // 会话表索引
  `
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_last_active ON sessions(user_id, last_active_at);
  `,
  // P1 #3: reports.uploaded_by → ON DELETE SET NULL（允许删除用户而不影响报告）
  `
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
  `,
  // P1 #4: report_views → 移除 report_id 的 ON DELETE CASCADE（删除报告时保留查看记录，防止免费额度被回收）
  `
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
  `
]

export const runMigrations = () => {
  migrations.forEach((statement) => {
    db.exec(statement)
  })
}
