import bcrypt from 'bcryptjs'

import { runMigrations } from '../db/migrate.js'
import { createUser, findUserByEmail } from '../modules/users/user.repository.js'

const DEFAULT_ADMIN_EMAIL = 'admin@fashion-report.local'
const DEFAULT_ADMIN_PASSWORD = 'ChangeMe123!'

export const bootstrapAdminUser = async () => {
  const existingUser = findUserByEmail(DEFAULT_ADMIN_EMAIL)

  if (existingUser) {
    return existingUser
  }

  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10)

  return createUser({
    email: DEFAULT_ADMIN_EMAIL,
    passwordHash,
    role: 'admin'
  })
}

export const initializeDatabase = async () => {
  runMigrations()
  await bootstrapAdminUser()
}

