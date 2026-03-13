import jwt, { type SignOptions } from 'jsonwebtoken'

import { config } from '../../config/index.js'
import type { AuthenticatedRequestUser, AuthTokens, SafeUser } from '../../types/models.js'

interface JwtPayload extends jwt.JwtPayload {
  sub: string
  email: string
  role: AuthenticatedRequestUser['role']
  type: 'access' | 'refresh'
}

const createToken = (user: SafeUser, type: 'access' | 'refresh') => {
  const expiresIn = type === 'access' ? config.ACCESS_TOKEN_EXPIRES_IN : config.REFRESH_TOKEN_EXPIRES_IN
  const options: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] }

  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      type
    },
    config.JWT_SECRET,
    options
  )
}

export const issueTokens = (user: SafeUser): AuthTokens => ({
  accessToken: createToken(user, 'access'),
  refreshToken: createToken(user, 'refresh')
})

export const verifyAccessToken = (token: string): AuthenticatedRequestUser => {
  const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload

  if (payload.type !== 'access') {
    throw new Error('Invalid token type')
  }

  return {
    id: Number(payload.sub),
    email: payload.email,
    role: payload.role
  }
}
