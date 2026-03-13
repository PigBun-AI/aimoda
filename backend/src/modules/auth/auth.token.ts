import crypto from 'node:crypto'

import jwt, { type SignOptions } from 'jsonwebtoken'

import { config } from '../../config/index.js'
import type { AuthenticatedRequestUser, AuthTokens, SafeUser } from '../../types/models.js'

interface JwtPayload extends jwt.JwtPayload {
  sub: string
  email: string
  role: AuthenticatedRequestUser['role']
  type: 'access' | 'refresh'
  jti: string // JWT ID for uniqueness
  sessionId?: number // Session ID for SSO validation
}

const createToken = (user: SafeUser, type: 'access' | 'refresh', sessionId?: number) => {
  const expiresIn = type === 'access' ? config.ACCESS_TOKEN_EXPIRES_IN : config.REFRESH_TOKEN_EXPIRES_IN
  const options: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] }

  // Add random JWT ID to ensure each token is unique (prevents duplicate refresh tokens)
  const jti = crypto.randomUUID()

  const payload: Record<string, unknown> = {
    sub: String(user.id),
    email: user.email,
    role: user.role,
    type,
    jti
  }

  // Include session ID in access token for SSO validation
  if (type === 'access' && sessionId) {
    payload.sessionId = sessionId
  }

  return jwt.sign(payload, config.JWT_SECRET, options)
}

export const issueTokens = (user: SafeUser, sessionId?: number): AuthTokens => ({
  accessToken: createToken(user, 'access', sessionId),
  refreshToken: createToken(user, 'refresh')
})

export const verifyAccessToken = (token: string): AuthenticatedRequestUser & { sessionId?: number } => {
  const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload

  if (payload.type !== 'access') {
    throw new Error('Invalid token type')
  }

  return {
    id: Number(payload.sub),
    email: payload.email,
    role: payload.role,
    sessionId: payload.sessionId
  }
}
