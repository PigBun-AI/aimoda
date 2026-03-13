import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

const importConfigModule = async () => import('../src/config/index.js')

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('config security', () => {
  it('fails when JWT_SECRET is missing at runtime', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_PATH: '/tmp/fashion-report.db',
      REPORTS_DIR: '/tmp/reports',
      UPLOAD_TMP_DIR: '/tmp/uploads'
    }
    delete process.env.JWT_SECRET

    await expect(importConfigModule()).rejects.toThrow(/JWT_SECRET/)
  })

  it('fails when JWT_SECRET is shorter than required', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      JWT_SECRET: 'short-secret',
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_PATH: '/tmp/fashion-report.db',
      REPORTS_DIR: '/tmp/reports',
      UPLOAD_TMP_DIR: '/tmp/uploads'
    }

    await expect(importConfigModule()).rejects.toThrow(/JWT_SECRET/)
  })
})
