import crypto from 'node:crypto'

import { db } from '../../db/client.js'
import type { DeviceInfo, SessionRecord } from '../../types/models.js'

const mapSession = (row: Record<string, unknown>): SessionRecord => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  refreshTokenHash: String(row.refresh_token_hash),
  deviceInfo: row.device_info ? String(row.device_info) : null,
  ipAddress: row.ip_address ? String(row.ip_address) : null,
  userAgent: row.user_agent ? String(row.user_agent) : null,
  lastActiveAt: String(row.last_active_at),
  expiresAt: String(row.expires_at),
  createdAt: String(row.created_at)
})

/**
 * 对 refresh token 进行哈希处理
 * 使用 SHA-256 确保即使数据库泄露，token 也无法被逆向
 */
export const hashRefreshToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * 创建新会话
 * 如果用户已有其他会话，将使旧会话失效（单点登录）
 */
export const createSession = (input: {
  userId: number
  refreshToken: string
  deviceInfo?: DeviceInfo
  ipAddress?: string
  userAgent?: string
  expiresAt: string
}): SessionRecord => {
  const refreshTokenHash = hashRefreshToken(input.refreshToken)
  const deviceInfoJson = input.deviceInfo ? JSON.stringify(input.deviceInfo) : null

  const row = db.prepare(
    `INSERT INTO sessions (user_id, refresh_token_hash, device_info, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`
  ).get(
    input.userId,
    refreshTokenHash,
    deviceInfoJson,
    input.ipAddress ?? null,
    input.userAgent ?? null,
    input.expiresAt
  ) as Record<string, unknown>

  return mapSession(row)
}

/**
 * 使除当前会话外的所有其他会话失效（单点登录）
 */
export const invalidateOtherSessions = (userId: number, currentSessionId: number): number => {
  const result = db.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND id != ?'
  ).run(userId, currentSessionId)
  return result.changes
}

/**
 * 通过 refresh token 查找会话
 */
export const findSessionByRefreshToken = (refreshToken: string): SessionRecord | null => {
  const tokenHash = hashRefreshToken(refreshToken)
  const row = db.prepare(
    "SELECT * FROM sessions WHERE refresh_token_hash = ? AND expires_at > datetime('now')"
  ).get(tokenHash) as Record<string, unknown> | undefined

  return row ? mapSession(row) : null
}

/**
 * 查找用户的活跃会话
 */
export const findActiveSessionsByUserId = (userId: number): SessionRecord[] => {
  const rows = db.prepare(
    `SELECT * FROM sessions
     WHERE user_id = ? AND expires_at > datetime('now')
     ORDER BY last_active_at DESC`
  ).all(userId) as Record<string, unknown>[]

  return rows.map(mapSession)
}

/**
 * 获取用户当前活跃会话数量
 */
export const getActiveSessionCount = (userId: number): number => {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND expires_at > datetime('now')"
  ).get(userId) as { count: number }
  return row.count
}

/**
 * 更新会话的最后活跃时间
 */
export const updateSessionLastActive = (sessionId: number): void => {
  db.prepare(
    "UPDATE sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(sessionId)
}

/**
 * 更新会话的 refresh token
 */
export const updateSessionToken = (sessionId: number, refreshToken: string): void => {
  const refreshTokenHash = hashRefreshToken(refreshToken)
  db.prepare(
    "UPDATE sessions SET refresh_token_hash = ? WHERE id = ?"
  ).run(refreshTokenHash, sessionId)
}

/**
 * 使会话失效（登出）
 */
export const invalidateSession = (sessionId: number): boolean => {
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  return result.changes > 0
}

/**
 * 通过 refresh token 使会话失效（登出）
 */
export const invalidateSessionByToken = (refreshToken: string): boolean => {
  const tokenHash = hashRefreshToken(refreshToken)
  const result = db.prepare('DELETE FROM sessions WHERE refresh_token_hash = ?').run(tokenHash)
  return result.changes > 0
}

/**
 * 使所有用户会话失效（强制登出所有设备）
 */
export const invalidateAllUserSessions = (userId: number): number => {
  const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  return result.changes
}

/**
 * 清理过期会话
 */
export const cleanupExpiredSessions = (): number => {
  const result = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run()
  return result.changes
}

/**
 * 检查会话是否存在且有效
 */
export const isSessionValid = (sessionId: number): boolean => {
  const row = db.prepare(
    "SELECT id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).get(sessionId) as { id: number } | undefined
  return !!row
}