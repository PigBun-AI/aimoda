import { createApp } from './app.js'
import { config } from './config/index.js'

export const startServer = () => {
  const app = createApp()

  return app.listen(config.PORT, () => {
    console.log(`API server listening on port ${config.PORT}`)
  })
}

if (process.env.NODE_ENV !== 'test') {
  startServer()
}
