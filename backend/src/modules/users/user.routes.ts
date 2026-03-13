import { Router } from 'express'

import { requireAuth, requireRole } from '../../middleware/auth.middleware.js'
import { asyncHandler } from '../../middleware/error.middleware.js'
import { getUsers, registerUser } from './user.service.js'
import { getUserSubscription } from '../subscriptions/subscription.service.js'

export const userRouter = Router()

userRouter.get(
  '/',
  requireAuth,
  requireRole(['admin']),
  asyncHandler(async (_request, response) => {
    response.json({ success: true, data: getUsers() })
  })
)

userRouter.post(
  '/',
  requireAuth,
  requireRole(['admin']),
  asyncHandler(async (request, response) => {
    const user = await registerUser(request.body)
    response.status(201).json({ success: true, data: user })
  })
)

userRouter.get(
  '/me/subscription',
  requireAuth,
  asyncHandler(async (request, response) => {
    const subscription = getUserSubscription(request.user!.id)
    response.json({ success: true, data: subscription })
  })
)
