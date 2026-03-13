import crypto from 'node:crypto'

import { config } from '../../config/index.js'
import type { AuthTokens, DeviceInfo, SafeUser, SessionRecord } from '../../types/models.js'
import { issueTokens } from '../auth/auth.token.js'
import {
  createSession,
  findActiveSessionsByUserId,
  findSessionByRefreshToken,
  invalidateOtherSessions,
  invalidateSessionByToken,
  invalidateAllUserSessions,
  cleanupExpiredSessions,
  updateSessionLastActive,
  updateSessionToken
} from './session.repository.js'

/**
 * 计算刷新令牌过期时间
 */
const getRefreshTokenExpiry = (): string => {
  const expiresInSeconds = parseExpiresIn(config.REFRESH_TOKEN_EXPIRES_IN)
  const expiryDate = new Date(Date.now() + expiresInSeconds * 1000)
  return expiryDate.toISOString()
}

/**
 * 解析过期时间字符串
 */
const parseExpiresIn = (expiresIn: string): number => {
  const match = expiresIn.match(/^(\d+)([hdmy])$/)
  if (!match) return 7 * 24 * 60 * 60 // 默认 7 天

  const value = parseInt(match[1], 10)
  switch (match[2]) {
    case 'h': return value * 60 * 60
    case 'd': return value * 24 * 60 * 60
    case 'm': return value * 30 * 24 * 60 * 60
    case 'y': return value * 365 * 24 * 60 * 60
    default: return 7 * 24 * 60 * 60
  }
}

/**
 * 从 User-Agent 解析设备信息
 */
export const parseDeviceInfo = (userAgent: string): DeviceInfo => {
  const deviceInfo: DeviceInfo = {}

  // 检测操作系统
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    deviceInfo.os = 'iOS'
    deviceInfo.device = /iPad/.test(userAgent) ? 'tablet' : 'mobile'
  } else if (/Android/.test(userAgent)) {
    deviceInfo.os = 'Android'
    deviceInfo.device = /Mobile/.test(userAgent) ? 'mobile' : 'tablet'
  } else if (/Windows/.test(userAgent)) {
    deviceInfo.os = 'Windows'
    deviceInfo.device = 'desktop'
  } else if (/Mac/.test(userAgent)) {
    deviceInfo.os = 'macOS'
    deviceInfo.device = 'desktop'
  } else if (/Linux/.test(userAgent)) {
    deviceInfo.os = 'Linux'
    deviceInfo.device = 'desktop'
  }

  // 检测浏览器
  if (/Edg/.test(userAgent)) {
    deviceInfo.browser = 'Edge'
  } else if (/Chrome/.test(userAgent)) {
    deviceInfo.browser = 'Chrome'
  } else if (/Safari/.test(userAgent)) {
    deviceInfo.browser = 'Safari'
  } else if (/Firefox/.test(userAgent)) {
    deviceInfo.browser = 'Firefox'
  }

  // 生成设备名称
  const parts = [deviceInfo.browser, deviceInfo.os, deviceInfo.device].filter(Boolean)
  deviceInfo.deviceName = parts.join(' - ') || 'Unknown Device'

  return deviceInfo
}

/**
 * 用户登录，创建会话并返回令牌
 * 实现单点登录：普通用户使其他会话失效，管理员允许多设备登录
 */
export const loginWithSession = (user: SafeUser, input: {
  userAgent?: string
  ipAddress?: string
}): { tokens: AuthTokens; session: SessionRecord; kickedOtherDevices: boolean } => {
  const deviceInfo = input.userAgent ? parseDeviceInfo(input.userAgent) : undefined

  // 先创建会话（refresh token 稍后更新）
  const expiresAt = getRefreshTokenExpiry()
  const tempSession = createSession({
    userId: user.id,
    refreshToken: 'temp-' + crypto.randomUUID(), // 临时 token，稍后更新
    deviceInfo,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    expiresAt
  })

  // 使用会话 ID 生成令牌
  const tokens = issueTokens(user, tempSession.id)

  // 更新会话的 refresh token
  updateSessionToken(tempSession.id, tokens.refreshToken)

  // 单点登录：普通用户使其他会话失效，管理员允许多设备
  let kickedOtherDevices = false
  if (user.role !== 'admin') {
    const invalidatedCount = invalidateOtherSessions(user.id, tempSession.id)
    kickedOtherDevices = invalidatedCount > 0
  }

  return { tokens, session: tempSession, kickedOtherDevices }
}

/**
 * 刷新访问令牌
 * 验证 refresh token 并创建新会话
 */
export const refreshTokens = (refreshToken: string, input: {
  userAgent?: string
  ipAddress?: string
}): { tokens: AuthTokens; session: SessionRecord; userId: number } | null => {
  const session = findSessionByRefreshToken(refreshToken)

  if (!session) {
    return null
  }

  // 更新最后活跃时间
  updateSessionLastActive(session.id)

  // 删除旧会话
  invalidateSessionByToken(refreshToken)

  // 创建新会话
  const deviceInfo = input.userAgent ? parseDeviceInfo(input.userAgent) : undefined

  const newSession = createSession({
    userId: session.userId,
    refreshToken: '', // 将被新 token 替换
    deviceInfo,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    expiresAt: getRefreshTokenExpiry()
  })

  // 生成新令牌（需要重新获取用户信息）
  // 这里返回 userId，由调用者处理
  return {
    tokens: {
      accessToken: '', // 由调用者生成
      refreshToken: ''  // 由调用者生成
    },
    session: newSession,
    userId: session.userId
  }
}

/**
 * 登出（使当前会话失效）
 */
export const logout = (refreshToken: string): boolean => {
  return invalidateSessionByToken(refreshToken)
}

/**
 * 登出所有设备
 */
export const logoutAllDevices = (userId: number): number => {
  return invalidateAllUserSessions(userId)
}

/**
 * 获取用户所有活跃会话
 */
export const getUserSessions = (userId: number): SessionRecord[] => {
  return findActiveSessionsByUserId(userId)
}

/**
 * 定期清理过期会话（可由定时任务调用）
 */
export const cleanExpiredSessions = (): number => {
  return cleanupExpiredSessions()
}