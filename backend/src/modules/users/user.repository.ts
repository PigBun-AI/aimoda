import { db } from '../../db/client.js'
import type { UserRecord, UserRole } from '../../types/models.js'

interface CreateUserInput {
  email: string
  passwordHash: string
  role: UserRole
}

const mapUser = (row: Record<string, unknown>): UserRecord => ({
  id: Number(row.id),
  email: String(row.email),
  passwordHash: String(row.password_hash),
  role: row.role as UserRole,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
})

export const findUserByEmail = (email: string): UserRecord | null => {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Record<string, unknown> | undefined
  return row ? mapUser(row) : null
}

export const findUserById = (id: number): UserRecord | null => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? mapUser(row) : null
}

export const listUsers = (): UserRecord[] => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all() as Record<string, unknown>[]
  return rows.map(mapUser)
}

export const countUsers = (): number => {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  return row.count
}

export const countUsersByRole = (): Record<string, number> => {
  const rows = db.prepare('SELECT role, COUNT(*) as count FROM users GROUP BY role').all() as Array<{ role: string; count: number }>
  return Object.fromEntries(rows.map(r => [r.role, r.count]))
}

export const createUser = ({ email, passwordHash, role }: CreateUserInput): UserRecord => {
  const insert = db.prepare(
    'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?) RETURNING *'
  )

  const row = insert.get(email, passwordHash, role) as Record<string, unknown>
  return mapUser(row)
}
