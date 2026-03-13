import { Router } from 'express'

import { authRouter } from '../modules/auth/auth.routes.js'
import { mcpRouter } from '../modules/mcp/mcp.routes.js'
import { reportRouter } from '../modules/reports/report.routes.js'
import { userRouter } from '../modules/users/user.routes.js'
import { adminRouter } from '../modules/admin/admin.routes.js'
import { adminRedemptionCodeRouter, redemptionCodeRouter } from '../modules/redemption-codes/redemption-code.routes.js'

export const apiRouter = Router()

apiRouter.get('/health', (_request, response) => {
  response.json({ success: true, data: { status: 'ok' } })
})

apiRouter.use('/auth', authRouter)
apiRouter.use('/users', userRouter)
apiRouter.use('/reports', reportRouter)
apiRouter.use('/mcp', mcpRouter)
apiRouter.use('/admin', adminRouter)
apiRouter.use('/admin/redemption-codes', adminRedemptionCodeRouter)
apiRouter.use('/redemption-codes', redemptionCodeRouter)
