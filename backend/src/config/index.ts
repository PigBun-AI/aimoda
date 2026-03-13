import path from 'node:path'

import { envSchema } from './env.js'

const runtimeJwtSecret = process.env.JWT_SECRET

const parsedEnv = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  JWT_SECRET: runtimeJwtSecret,
  FRONTEND_URL: process.env.FRONTEND_URL,
  REPORTS_DIR: process.env.REPORTS_DIR,
  DATABASE_PATH: process.env.DATABASE_PATH,
  ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN,
  UPLOAD_TMP_DIR: process.env.UPLOAD_TMP_DIR
})

export const config = {
  ...parsedEnv,
  REPORTS_DIR: path.resolve(parsedEnv.REPORTS_DIR),
  DATABASE_PATH: path.resolve(parsedEnv.DATABASE_PATH),
  UPLOAD_TMP_DIR: path.resolve(parsedEnv.UPLOAD_TMP_DIR)
}
