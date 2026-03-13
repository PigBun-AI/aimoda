import { db } from '../../db/client.js'
import type { ActivityAction, ActivityLogRecord } from '../../types/models.js'

const mapActivityLog = (row: Record<string, unknown>): ActivityLogRecord => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  action: row.action as ActivityAction,
  createdAt: String(row.created_at)
})

export const logActivity = (userId: number, action: ActivityAction): void => {
  db.prepare('INSERT INTO user_activity_logs (user_id, action) VALUES (?, ?)').run(userId, action)
}

export const getDailyActivePercent = (): number => {
  const active = db.prepare(
    "SELECT COUNT(DISTINCT user_id) as count FROM user_activity_logs WHERE date(created_at) = date('now')"
  ).get() as { count: number }

  const total = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }

  if (total.count === 0) return 0
  return Math.round((active.count / total.count) * 10000) / 100
}

export const getActivityTrend = (days: number): Array<{ date: string; count: number }> => {
  const rows = db.prepare(
    `SELECT date(created_at) as date, COUNT(DISTINCT user_id) as count
     FROM user_activity_logs
     WHERE created_at >= datetime('now', ?)
     GROUP BY date(created_at)
     ORDER BY date ASC`
  ).all(`-${days} days`) as Array<{ date: string; count: number }>

  return rows
}
