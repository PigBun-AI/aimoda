import type { NextFunction, Request, Response } from 'express'

import { verifyAccessToken } from '../modules/auth/auth.token.js'
import type { AuthenticatedRequestUser, UserRole } from '../types/models.js'

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedRequestUser
  }
}

export const requireAuth = (request: Request, response: Response, next: NextFunction) => {
  const authorizationHeader = request.header('authorization')

  if (!authorizationHeader?.startsWith('Bearer ')) {
    response.status(401).json({ success: false, error: '未提供有效的认证令牌' })
    return
  }

  const token = authorizationHeader.slice('Bearer '.length)

  try {
    request.user = verifyAccessToken(token)
    next()
  } catch {
    response.status(401).json({ success: false, error: '认证令牌无效或已过期' })
  }
}

export const requireRole = (roles: UserRole[]) => (request: Request, response: Response, next: NextFunction) => {
  if (!request.user) {
    response.status(401).json({ success: false, error: '未认证用户无法访问该资源' })
    return
  }

  if (!roles.includes(request.user.role)) {
    response.status(403).json({ success: false, error: '权限不足' })
    return
  }

  next()
}
