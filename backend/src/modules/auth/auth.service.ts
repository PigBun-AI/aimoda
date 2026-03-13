import bcrypt from 'bcryptjs'

import { AppError } from '../../types/app-error.js'
import { loginSchema, registerSchema } from '../users/user.schema.js'
import { toSafeUser } from '../users/user.mapper.js'
import { createUser, findUserByEmail } from '../users/user.repository.js'
import { logActivity } from '../activity/activity.repository.js'
import { issueTokens } from './auth.token.js'

export const login = async (input: unknown) => {
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

  logActivity(user.id, 'login')

  return {
    user: safeUser,
    tokens: issueTokens(safeUser)
  }
}

export const register = async (input: unknown) => {
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

  return {
    user: safeUser,
    tokens: issueTokens(safeUser)
  }
}
