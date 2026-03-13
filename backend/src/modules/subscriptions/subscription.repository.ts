import { db } from '../../db/client.js'
import type { SubscriptionRecord } from '../../types/models.js'

interface CreateSubscriptionInput {
  userId: number
  startsAt: string
  endsAt: string
  sourceCodeId: number
}

const mapSubscription = (row: Record<string, unknown>): SubscriptionRecord => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  startsAt: String(row.starts_at),
  endsAt: String(row.ends_at),
  sourceCodeId: Number(row.source_code_id),
  status: row.status as SubscriptionRecord['status'],
  createdAt: String(row.created_at)
})

export const createSubscription = (input: CreateSubscriptionInput): SubscriptionRecord => {
  const row = db.prepare(
    `INSERT INTO subscriptions (user_id, starts_at, ends_at, source_code_id)
     VALUES (?, ?, ?, ?) RETURNING *`
  ).get(input.userId, input.startsAt, input.endsAt, input.sourceCodeId) as Record<string, unknown>

  return mapSubscription(row)
}

export const findActiveSubscriptionByUserId = (userId: number): SubscriptionRecord | null => {
  const row = db.prepare(
    `SELECT * FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND ends_at > datetime('now')
     ORDER BY ends_at DESC LIMIT 1`
  ).get(userId) as Record<string, unknown> | undefined

  return row ? mapSubscription(row) : null
}

export const getSubscriptionStats = (): { total: number; active: number; byType: Record<string, number> } => {
  const total = db.prepare('SELECT COUNT(*) as count FROM subscriptions').get() as { count: number }

  const active = db.prepare(
    "SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active' AND ends_at > datetime('now')"
  ).get() as { count: number }

  const byTypeRows = db.prepare(
    `SELECT rc.type, COUNT(*) as count
     FROM subscriptions s
     JOIN redemption_codes rc ON s.source_code_id = rc.id
     GROUP BY rc.type`
  ).all() as Array<{ type: string; count: number }>

  const byType = Object.fromEntries(byTypeRows.map(r => [r.type, r.count]))

  return { total: total.count, active: active.count, byType }
}
