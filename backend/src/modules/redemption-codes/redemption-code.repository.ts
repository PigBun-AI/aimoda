import { db } from '../../db/client.js'
import type { RedemptionCodeRecord, RedemptionCodeType } from '../../types/models.js'

interface CreateRedemptionCodeInput {
  code: string
  type: RedemptionCodeType
  createdBy: number
  expiresAt: string
}

const mapRedemptionCode = (row: Record<string, unknown>): RedemptionCodeRecord => ({
  id: Number(row.id),
  code: String(row.code),
  type: row.type as RedemptionCodeType,
  status: row.status as RedemptionCodeRecord['status'],
  createdBy: Number(row.created_by),
  usedBy: row.used_by ? Number(row.used_by) : null,
  createdAt: String(row.created_at),
  usedAt: row.used_at ? String(row.used_at) : null,
  expiresAt: String(row.expires_at),
})

export const createRedemptionCode = (input: CreateRedemptionCodeInput): RedemptionCodeRecord => {
  const row = db.prepare(
    `INSERT INTO redemption_codes (code, type, created_by, expires_at) VALUES (?, ?, ?, ?) RETURNING *`
  ).get(input.code, input.type, input.createdBy, input.expiresAt) as Record<string, unknown>
  return mapRedemptionCode(row)
}

export const findCodeByCode = (code: string): RedemptionCodeRecord | null => {
  const row = db.prepare('SELECT * FROM redemption_codes WHERE code = ?').get(code) as Record<string, unknown> | undefined
  return row ? mapRedemptionCode(row) : null
}

export const listCodes = (): RedemptionCodeRecord[] => {
  const rows = db.prepare('SELECT * FROM redemption_codes ORDER BY id DESC').all() as Record<string, unknown>[]
  return rows.map(mapRedemptionCode)
}

export const markCodeUsed = (id: number, userId: number): void => {
  db.prepare(
    `UPDATE redemption_codes SET status = 'used', used_by = ?, used_at = datetime('now') WHERE id = ?`
  ).run(userId, id)
}
