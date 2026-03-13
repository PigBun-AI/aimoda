import { Router } from 'express'

import { requireAuth } from '../../middleware/auth.middleware.js'
import { asyncHandler } from '../../middleware/error.middleware.js'
import { authLoginRateLimiter } from '../../middleware/rate-limit.middleware.js'
import {
  login,
  register,
  logout,
  logoutAll,
  getSessions,
  terminateSession,
  getCurrentUser
} from './auth.service.js'

/**
 * 从请求中提取设备信息
 */
const extractDeviceContext = (request: import('express').Request) => {
  const forwarded = request.headers['x-forwarded-for']
  const cfIp = request.headers['cf-connecting-ip']

  return {
    userAgent: request.headers['user-agent'],
    ipAddress: typeof cfIp === 'string' ? cfIp
      : typeof forwarded === 'string' ? forwarded.split(',')[0].trim()
      : request.ip
  }
}

export const authRouter = Router()

// 登录
authRouter.post(
  '/login',
  authLoginRateLimiter,
  asyncHandler(async (request, response) => {
    const deviceContext = extractDeviceContext(request)
    const result = await login(request.body, deviceContext)

    response.json({
      success: true,
      data: {
        user: result.user,
        tokens: result.tokens
      },
      message: result.kickedOtherDevices
        ? '您已在其他设备登出'
        : undefined
    })
  })
)

// 注册
authRouter.post(
  '/register',
  authLoginRateLimiter,
  asyncHandler(async (request, response) => {
    const deviceContext = extractDeviceContext(request)
    const result = await register(request.body, deviceContext)

    response.status(201).json({
      success: true,
      data: {
        user: result.user,
        tokens: result.tokens
      }
    })
  })
)

// 获取当前用户信息
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (request, response) => {
    const user = getCurrentUser(request.user!.id)
    response.json({ success: true, data: user })
  })
)

// 登出当前设备
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (request, response) => {
    const { refreshToken } = request.body

    if (refreshToken) {
      logout(refreshToken)
    }

    response.json({ success: true, message: '已登出' })
  })
)

// 登出所有设备
authRouter.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (request, response) => {
    const count = logoutAll(request.user!.id)

    response.json({
      success: true,
      message: `已登出 ${count} 个设备`,
      data: { terminatedCount: count }
    })
  })
)

// 获取活跃会话列表
authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (request, response) => {
    const sessions = getSessions(request.user!.id)

    // 不返回敏感的 token hash
    const safeSessions = sessions.map(s => ({
      id: s.id,
      deviceInfo: s.deviceInfo ? JSON.parse(s.deviceInfo) : null,
      ipAddress: s.ipAddress,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt
    }))

    response.json({ success: true, data: safeSessions })
  })
)

// 登出指定设备
authRouter.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler(async (request, response) => {
    const sessionId = Number(request.params.id)
    const success = terminateSession(request.user!.id, sessionId)

    if (!success) {
      response.status(404).json({ success: false, error: '会话不存在' })
      return
    }

    response.json({ success: true, message: '设备已登出' })
  })
)