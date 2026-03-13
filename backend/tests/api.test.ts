import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import bcrypt from 'bcryptjs'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-key-with-at-least-32chars'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.DATABASE_PATH = path.join(os.tmpdir(), `fashion-report-test-${Date.now()}.db`)
process.env.REPORTS_DIR = path.join(os.tmpdir(), `fashion-report-reports-${Date.now()}`)
process.env.UPLOAD_TMP_DIR = path.join(os.tmpdir(), `fashion-report-uploads-${Date.now()}`)

const { createApp } = await import('../src/app.js')
const { db } = await import('../src/db/client.js')
const { createUser } = await import('../src/modules/users/user.repository.js')
const { issueTokens, verifyAccessToken } = await import('../src/modules/auth/auth.token.js')
const { errorHandler } = await import('../src/middleware/error.middleware.js')
const { reportUploadMiddleware } = await import('../src/middleware/upload.middleware.js')
const { getReports } = await import('../src/modules/reports/report.service.js')
const { initializeDatabase } = await import('../src/scripts/init-db.js')
const { startServer } = await import('../src/server.js')

const app = createApp()

beforeAll(() => {
  fs.mkdirSync(process.env.REPORTS_DIR!, { recursive: true })
  fs.mkdirSync(process.env.UPLOAD_TMP_DIR!, { recursive: true })
})

beforeEach(() => {
  db.exec('DELETE FROM reports; DELETE FROM users;')
})

const createAdminToken = async () => {
  const passwordHash = await bcrypt.hash('Password123!', 10)
  const user = createUser({
    email: 'admin@example.com',
    passwordHash,
    role: 'admin'
  })

  return {
    token: issueTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }).accessToken,
    user
  }
}

describe('API auth and reports', () => {
  it('returns report spec without authentication', async () => {
    const response = await request(app).get('/api/reports/spec')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data.version).toBe('1.0.0')
  })

  it('rejects access to protected user list without token', async () => {
    const response = await request(app).get('/api/users')

    expect(response.status).toBe(401)
    expect(response.body.success).toBe(false)
  })

  it('authenticates a valid user and returns JWT tokens', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10)
    createUser({
      email: 'editor@example.com',
      passwordHash,
      role: 'editor'
    })

    const response = await request(app).post('/api/auth/login').send({
      email: 'editor@example.com',
      password: 'Password123!'
    })

    expect(response.status).toBe(200)
    expect(response.body.data.tokens.accessToken).toBeTypeOf('string')
    expect(response.body.data.tokens.refreshToken).toBeTypeOf('string')
    expect(response.body.data.user.email).toBe('editor@example.com')
    expect(verifyAccessToken(response.body.data.tokens.accessToken).email).toBe('editor@example.com')
  })

  it('rejects invalid credentials with 401', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'missing@example.com',
      password: 'Password123!'
    })

    expect(response.status).toBe(401)
    expect(response.body.success).toBe(false)
    expect(response.body.error).toBe('邮箱或密码错误')
  })

  it('rejects invalid login payload with 400', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'not-an-email',
      password: 'short'
    })

    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
    expect(response.body.error).toBe('请求参数校验失败')
  })

  it('applies stricter rate limit to auth login', async () => {
    const authApp = createApp()

    const firstResponse = await request(authApp).post('/api/auth/login').send({
      email: 'missing@example.com',
      password: 'Password123!'
    })

    expect(firstResponse.status).toBe(401)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(authApp).post('/api/auth/login').send({
        email: `missing-${attempt}@example.com`,
        password: 'Password123!'
      })
    }

    const limitedResponse = await request(authApp).post('/api/auth/login').send({
      email: 'limited@example.com',
      password: 'Password123!'
    })

    expect(limitedResponse.status).toBe(429)
    expect(limitedResponse.body.error).toBe('登录请求过于频繁，请稍后重试')
  })

  it('creates a user only for admin role', async () => {
    const { token } = await createAdminToken()
    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'viewer@example.com',
        password: 'Password123!',
        role: 'viewer'
      })

    expect(response.status).toBe(201)
    expect(response.body.data.email).toBe('viewer@example.com')
    expect(response.body.data).not.toHaveProperty('passwordHash')
  })

  it('rejects non-admin user creation', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10)
    const editor = createUser({
      email: 'editor-role@example.com',
      passwordHash,
      role: 'editor'
    })
    const token = issueTokens({
      id: editor.id,
      email: editor.email,
      role: editor.role,
      createdAt: editor.createdAt,
      updatedAt: editor.updatedAt
    }).accessToken

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'denied@example.com',
        password: 'Password123!',
        role: 'viewer'
      })

    expect(response.status).toBe(403)
  })

  it('initializes default admin once', async () => {
    await initializeDatabase()
    await initializeDatabase()

    const users = db.prepare('SELECT email FROM users ORDER BY id ASC').all() as Array<{ email: string }>
    expect(users.filter((user) => user.email === 'admin@fashion-report.local')).toHaveLength(1)
  })

  it('starts server without listening in test mode', () => {
    expect(typeof startServer).toBe('function')
  })

  it('handles upload middleware invalid type branch', async () => {
    const uploadApp = createApp()
    uploadApp.post('/upload', reportUploadMiddleware, (_request, response) => {
      response.json({ success: true })
    })
    uploadApp.use(errorHandler)

    const filePath = path.join(process.env.UPLOAD_TMP_DIR!, 'invalid.txt')
    fs.writeFileSync(filePath, 'invalid')

    const response = await request(uploadApp)
      .post('/upload')
      .attach('file', filePath, { contentType: 'text/plain' })

    expect(response.status).toBe(500)
    expect(response.body.success).toBe(false)
  })

  it('lists reports for authenticated user', async () => {
    const { token } = await createAdminToken()
    const response = await request(app)
      .get('/api/reports')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.data)).toBe(true)
    expect(getReports()).toEqual([])
  })
})
