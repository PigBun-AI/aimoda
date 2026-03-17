import cors from 'cors'
import express from 'express'

import { config } from './config/index.js'
import { runMigrations } from './db/migrate.js'
import { errorHandler } from './middleware/error.middleware.js'
import { apiRateLimiter } from './middleware/rate-limit.middleware.js'
import { apiRouter } from './routes/api.js'
import { initializeDatabase } from './scripts/init-db.js'

runMigrations()
await initializeDatabase()

export const createApp = () => {
  const app = express()

  app.set('trust proxy', 1)

  // CORS 配置：MCP 端点允许任意来源，其他端点限制为 FRONTEND_URL
  app.use((request, response, next) => {
    const isMcpEndpoint = request.path.startsWith('/api/mcp')
    const corsOrigin = isMcpEndpoint ? '*' : config.FRONTEND_URL

    response.setHeader('Access-Control-Allow-Origin', corsOrigin)
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }
    next()
  })
  app.use(express.json({ limit: '1mb' }))
  app.use('/api', apiRateLimiter, apiRouter)
  app.use(errorHandler)

  return app
}
