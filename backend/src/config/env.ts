import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  FRONTEND_URL: z.string().url().default('http://localhost'),
  REPORTS_DIR: z.string().min(1).default('/reports'),
  DATABASE_PATH: z.string().min(1).default('/data/fashion-report.db'),
  ACCESS_TOKEN_EXPIRES_IN: z.string().min(1).default('2h'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().min(1).default('7d'),
  UPLOAD_TMP_DIR: z.string().min(1).default('/tmp/fashion-report-uploads')
})

export type Env = z.infer<typeof envSchema>
