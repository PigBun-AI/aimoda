import { Router } from 'express'

import { requireAuth, requireRole } from '../../middleware/auth.middleware.js'
import { asyncHandler } from '../../middleware/error.middleware.js'
import { getDashboardData } from './admin.service.js'

export const adminRouter = Router()

adminRouter.use(requireAuth, requireRole(['admin']))

adminRouter.get('/dashboard', asyncHandler(async (_request, response) => {
  const data = getDashboardData()
  response.json({ success: true, data })
}))
