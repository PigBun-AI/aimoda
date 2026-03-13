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

  app.use(
    cors({
      origin: config.FRONTEND_URL,
      credentials: false
    })
  )
  app.use(express.json({ limit: '1mb' }))
  app.use('/api', apiRateLimiter, apiRouter)
  app.use(errorHandler)

  return app
}
