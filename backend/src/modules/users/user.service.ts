import bcrypt from 'bcryptjs'

import { createUserSchema } from './user.schema.js'
import { createUser, findUserByEmail, listUsers } from './user.repository.js'
import { toSafeUser } from './user.mapper.js'

export const registerUser = async (input: unknown) => {
  const parsed = createUserSchema.parse(input)

  if (findUserByEmail(parsed.email)) {
    throw new Error('邮箱已存在')
  }

  const passwordHash = await bcrypt.hash(parsed.password, 10)
  const user = createUser({
    email: parsed.email,
    passwordHash,
    role: parsed.role
  })

  return toSafeUser(user)
}

export const getUsers = () => listUsers().map(toSafeUser)
