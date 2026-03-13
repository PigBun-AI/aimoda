import crypto from 'node:crypto'

import { db } from '../../db/client.js'
import { AppError } from '../../types/app-error.js'
import type { RedemptionCodeRecord, RedemptionCodeType, SubscriptionRecord } from '../../types/models.js'
import { logActivity } from '../activity/activity.repository.js'
import { createSubscription } from '../subscriptions/subscription.repository.js'
import { createRedemptionCode, findCodeByCode, listCodes, markCodeUsed } from './redemption-code.repository.js'
import { generateCodesSchema, redeemCodeSchema } from './redemption-code.schema.js'

const typeToDays: Record<RedemptionCodeType, number> = {
  '1week': 7,
  '1month': 30,
  '3months': 90,
  '1year': 365,
}

export const generateCodes = (input: unknown, createdBy: number): RedemptionCodeRecord[] => {
  const parsed = generateCodesSchema.parse(input)
  const codes: RedemptionCodeRecord[] = []

  for (let i = 0; i < parsed.count; i++) {
    const code = crypto.randomBytes(16).toString('hex')
    const expiresAt = new Date(Date.now() + typeToDays[parsed.type] * 86400000).toISOString()
    const record = createRedemptionCode({
      code,
      type: parsed.type,
      createdBy,
      expiresAt,
    })
    codes.push(record)
  }

  return codes
}

export const redeemCode = (input: unknown, userId: number): SubscriptionRecord => {
  const parsed = redeemCodeSchema.parse(input)
  const code = findCodeByCode(parsed.code)

  if (!code || code.status !== 'unused') {
    throw new AppError('兑换码无效或已使用', 400)
  }

  if (new Date(code.expiresAt) < new Date()) {
    throw new AppError('兑换码已过期', 400)
  }

  const now = new Date()
  const endsAt = new Date(now.getTime() + typeToDays[code.type] * 86400000)

  const subscription = db.transaction(() => {
    markCodeUsed(code.id, userId)
    const sub = createSubscription({
      userId,
      startsAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
      sourceCodeId: code.id,
    })
    logActivity(userId, 'redeem_code')
    return sub
  })()

  return subscription
}

export const getCodes = (): RedemptionCodeRecord[] => {
  return listCodes()
}
