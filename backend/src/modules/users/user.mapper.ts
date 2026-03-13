import type { SafeUser, UserRecord } from '../../types/models.js'

export const toSafeUser = (user: UserRecord): SafeUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
})
