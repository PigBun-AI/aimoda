import { Router } from 'express'

import { requireAuth, requireRole } from '../../middleware/auth.middleware.js'
import { asyncHandler } from '../../middleware/error.middleware.js'
import { generateCodes, getCodes, redeemCode } from './redemption-code.service.js'

export const adminRedemptionCodeRouter = Router()
export const redemptionCodeRouter = Router()

adminRedemptionCodeRouter.post(
  '/',
  requireAuth,
  requireRole(['admin']),
  asyncHandler(async (request, response) => {
    const codes = generateCodes(request.body, request.user!.id)
    response.status(201).json({ success: true, data: codes })
  })
)

adminRedemptionCodeRouter.get(
  '/',
  requireAuth,
  requireRole(['admin']),
  asyncHandler(async (_request, response) => {
    const codes = getCodes()
    response.json({ success: true, data: codes })
  })
)

redemptionCodeRouter.post(
  '/redeem',
  requireAuth,
  asyncHandler(async (request, response) => {
    const subscription = redeemCode(request.body, request.user!.id)
    response.json({ success: true, data: { subscription } })
  })
)
