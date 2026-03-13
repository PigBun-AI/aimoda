import bcrypt from 'bcryptjs'

import { AppError } from '../../types/app-error.js'
import { loginSchema, registerSchema } from '../users/user.schema.js'
import { toSafeUser } from '../users/user.mapper.js'
import { createUser, findUserByEmail, findUserById } from '../users/user.repository.js'
import { logActivity } from '../activity/activity.repository.js'
import { issueTokens } from './auth.token.js'
import {
  loginWithSession,
  logout as logoutSession,
  logoutAllDevices,
  getUserSessions
} from '../sessions/session.service.js'
import { invalidateSessionByToken } from '../sessions/session.repository.js'
import type { SafeUser, SessionRecord } from '../../types/models.js'

interface LoginResult {
  user: SafeUser
  tokens: { accessToken: string; refreshToken: string }
  session?: SessionRecord
  kickedOtherDevices?: boolean
}

interface DeviceContext {
  userAgent?: string
  ipAddress?: string
}

/**
 * 用户登录
 * - 管理员：允许多设备登录
 * - 普通用户：单点登录，踢出其他设备
 */
export const login = async (input: unknown, deviceContext?: DeviceContext): Promise<LoginResult> => {
  const parsed = loginSchema.parse(input)
  const user = findUserByEmail(parsed.email)

  if (!user) {
    throw new AppError('邮箱或密码错误', 401)
  }

  const passwordMatches = await bcrypt.compare(parsed.password, user.passwordHash)

  if (!passwordMatches) {
    throw new AppError('邮箱或密码错误', 401)
  }

  const safeUser = toSafeUser(user)

  // 创建会话并获取令牌
  const { tokens, session } = loginWithSession(safeUser, {
    userAgent: deviceContext?.userAgent,
    ipAddress: deviceContext?.ipAddress
  })

  // 判断是否需要单点登录
  // 管理员不踢出其他设备，普通用户踢出其他设备
  let kickedOtherDevices = false
  if (user.role !== 'admin') {
    // session.service.ts 中的 loginWithSession 已经调用了 invalidateOtherSessions
    // 这里只记录日志
    kickedOtherDevices = true
  }

  logActivity(user.id, 'login')

  return {
    user: safeUser,
    tokens,
    session,
    kickedOtherDevices: user.role !== 'admin' && kickedOtherDevices
  }
}

/**
 * 用户注册
 */
export const register = async (input: unknown, deviceContext?: DeviceContext): Promise<LoginResult> => {
  const parsed = registerSchema.parse(input)

  if (findUserByEmail(parsed.email)) {
    throw new AppError('邮箱已被注册', 409)
  }

  const passwordHash = await bcrypt.hash(parsed.password, 10)
  const user = createUser({
    email: parsed.email,
    passwordHash,
    role: 'viewer'
  })

  const safeUser = toSafeUser(user)

  // 注册时创建会话
  const { tokens, session } = loginWithSession(safeUser, {
    userAgent: deviceContext?.userAgent,
    ipAddress: deviceContext?.ipAddress
  })

  return {
    user: safeUser,
    tokens,
    session,
    kickedOtherDevices: false
  }
}

/**
 * 登出当前设备
 */
export const logout = (refreshToken: string): boolean => {
  return logoutSession(refreshToken)
}

/**
 * 登出所有设备
 */
export const logoutAll = (userId: number): number => {
  return logoutAllDevices(userId)
}

/**
 * 获取用户活跃会话列表
 */
export const getSessions = (userId: number): SessionRecord[] => {
  return getUserSessions(userId)
}

/**
 * 删除指定会话（登出指定设备）
 */
export const terminateSession = (userId: number, sessionId: number): boolean => {
  const sessions = getUserSessions(userId)
  const targetSession = sessions.find(s => s.id === sessionId)

  if (!targetSession) {
    return false
  }

  return invalidateSessionByToken(targetSession.refreshTokenHash)
}

/**
 * 获取用户信息
 */
export const getCurrentUser = (userId: number): SafeUser | null => {
  const user = findUserById(userId)
  return user ? toSafeUser(user) : null
}