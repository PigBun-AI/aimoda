import { z } from 'zod'

export const generateCodesSchema = z.object({
  type: z.enum(['1week', '1month', '3months', '1year']),
  count: z.number().int().min(1).max(50).default(1),
})

export const redeemCodeSchema = z.object({
  code: z.string().min(1).max(32),
})
