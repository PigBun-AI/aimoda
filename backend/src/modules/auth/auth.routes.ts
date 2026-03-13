import { Router } from 'express'

import { requireAuth } from '../../middleware/auth.middleware.js'
import { asyncHandler } from '../../middleware/error.middleware.js'
import { authLoginRateLimiter } from '../../middleware/rate-limit.middleware.js'
import { login, register } from './auth.service.js'

export const authRouter = Router()

authRouter.post(
  '/login',
  authLoginRateLimiter,
  asyncHandler(async (request, response) => {
    const result = await login(request.body)
    response.json({ success: true, data: result })
  })
)

authRouter.post(
  '/register',
  authLoginRateLimiter,
  asyncHandler(async (request, response) => {
    const result = await register(request.body)
    response.status(201).json({ success: true, data: result })
  })
)

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (request, response) => {
    response.json({ success: true, data: request.user })
  })
)
