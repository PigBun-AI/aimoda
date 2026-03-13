import { db } from '../../db/client.js'
import type { ReportViewRecord } from '../../types/models.js'

const mapReportView = (row: Record<string, unknown>): ReportViewRecord => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  reportId: Number(row.report_id),
  viewedAt: String(row.viewed_at)
})

/**
 * 记录用户查看报告（如果未查看过）
 * @returns 是否为新查看记录
 */
export const recordReportView = (userId: number, reportId: number): boolean => {
  try {
    const result = db.prepare(
      `INSERT INTO report_views (user_id, report_id) VALUES (?, ?)`
    ).run(userId, reportId)
    return result.changes > 0
  } catch {
    // 违反 UNIQUE 约束说明已查看过
    return false
  }
}

/**
 * 检查用户是否已查看过某报告
 */
export const hasViewedReport = (userId: number, reportId: number): boolean => {
  const row = db.prepare(
    'SELECT 1 FROM report_views WHERE user_id = ? AND report_id = ? LIMIT 1'
  ).get(userId, reportId)
  return row !== undefined
}

/**
 * 获取用户已查看的报告数量
 */
export const getReportViewCount = (userId: number): number => {
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM report_views WHERE user_id = ?'
  ).get(userId) as { count: number }
  return row.count
}

/**
 * 获取用户已查看的报告ID列表
 */
export const getViewedReportIds = (userId: number): number[] => {
  const rows = db.prepare(
    'SELECT report_id FROM report_views WHERE user_id = ? ORDER BY viewed_at DESC'
  ).all(userId) as Array<{ report_id: number }>
  return rows.map(r => r.report_id)
}

/**
 * 获取用户的查看记录（分页）
 */
export const listUserReportViews = (userId: number, limit = 20, offset = 0): ReportViewRecord[] => {
  const rows = db.prepare(
    `SELECT * FROM report_views
     WHERE user_id = ?
     ORDER BY viewed_at DESC
     LIMIT ? OFFSET ?`
  ).all(userId, limit, offset) as Record<string, unknown>[]

  return rows.map(mapReportView)
}

/**
 * 获取用户查看指定报告的记录
 */
export const getReportView = (userId: number, reportId: number): ReportViewRecord | null => {
  const row = db.prepare(
    'SELECT * FROM report_views WHERE user_id = ? AND report_id = ?'
  ).get(userId, reportId) as Record<string, unknown> | undefined

  return row ? mapReportView(row) : null
}

/**
 * 清理用户的查看记录（订阅后可调用）
 */
export const clearUserReportViews = (userId: number): number => {
  const result = db.prepare('DELETE FROM report_views WHERE user_id = ?').run(userId)
  return result.changes
}