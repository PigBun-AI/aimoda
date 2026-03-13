import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import bcrypt from 'bcryptjs'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-key-with-at-least-32chars'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.DATABASE_PATH = path.join(os.tmpdir(), `fashion-report-upload-test-${Date.now()}.db`)
process.env.REPORTS_DIR = path.join(os.tmpdir(), `fashion-report-upload-reports-${Date.now()}`)
process.env.UPLOAD_TMP_DIR = path.join(os.tmpdir(), `fashion-report-upload-tmp-${Date.now()}`)

const { createApp } = await import('../src/app.js')
const { db } = await import('../src/db/client.js')
const { createUser } = await import('../src/modules/users/user.repository.js')
const { issueTokens } = await import('../src/modules/auth/auth.token.js')
const { uploadReportArchive } = await import('../src/modules/reports/report.service.js')

const app = createApp()

const makeZipFixture = async (targetPath: string, reportName: string, includeOverview = true) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-fixture-'))
  const reportDirectory = path.join(root, reportName)
  fs.mkdirSync(path.join(reportDirectory, 'images'), { recursive: true })
  fs.writeFileSync(path.join(reportDirectory, 'index.html'), '<html><head><title>Chanel Spring 2027 RTW</title></head></html>')
  if (includeOverview) {
    fs.writeFileSync(path.join(reportDirectory, 'overview.html'), '<html></html>')
  }
  fs.writeFileSync(path.join(reportDirectory, 'images', 'look-001.jpg'), 'image')

  const { execFileSync } = await import('node:child_process')
  execFileSync('zip', ['-rq', targetPath, reportName], { cwd: root })
  fs.rmSync(root, { recursive: true, force: true })
}

const createAdminToken = async () => {
  const passwordHash = await bcrypt.hash('Password123!', 10)
  const user = createUser({
    email: 'upload-admin@example.com',
    passwordHash,
    role: 'admin'
  })

  return issueTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  }).accessToken
}

beforeAll(() => {
  fs.mkdirSync(process.env.REPORTS_DIR!, { recursive: true })
  fs.mkdirSync(process.env.UPLOAD_TMP_DIR!, { recursive: true })
})

beforeEach(() => {
  db.exec('DELETE FROM reports; DELETE FROM users;')
  fs.rmSync(process.env.REPORTS_DIR!, { recursive: true, force: true })
  fs.mkdirSync(process.env.REPORTS_DIR!, { recursive: true })
})

afterAll(() => {
  fs.rmSync(process.env.REPORTS_DIR!, { recursive: true, force: true })
  fs.rmSync(process.env.UPLOAD_TMP_DIR!, { recursive: true, force: true })
})

describe('report upload flow', () => {
  it('uploads a valid report archive', async () => {
    const token = await createAdminToken()
    const archivePath = path.join(process.env.UPLOAD_TMP_DIR!, 'valid-report.zip')
    await makeZipFixture(archivePath, 'chanel-spring-2027')

    const response = await request(app)
      .post('/api/reports/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', archivePath)

    expect(response.status).toBe(201)
    expect(response.body.report.slug).toBe('chanel-spring-2027')
    expect(fs.existsSync(path.join(process.env.REPORTS_DIR!, 'chanel-spring-2027', 'index.html'))).toBe(true)
  })

  it('rejects duplicate report slug upload', async () => {
    const token = await createAdminToken()
    const firstArchive = path.join(process.env.UPLOAD_TMP_DIR!, 'first.zip')
    const secondArchive = path.join(process.env.UPLOAD_TMP_DIR!, 'second.zip')
    await makeZipFixture(firstArchive, 'chanel-spring-2027')
    await makeZipFixture(secondArchive, 'chanel-spring-2027')

    await request(app)
      .post('/api/reports/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', firstArchive)

    const response = await request(app)
      .post('/api/reports/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', secondArchive)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('已存在')
  })

  it('rejects archive missing required files', async () => {
    const archivePath = path.join(process.env.UPLOAD_TMP_DIR!, 'invalid-report.zip')
    await makeZipFixture(archivePath, 'chanel-spring-2027', false)

    await expect(uploadReportArchive({ archivePath, uploadedBy: 1 })).rejects.toThrow('缺少必需文件 overview.html')
  })

  it('rejects sibling-prefix traversal entries during extraction', async () => {
    const maliciousArchive = path.join(process.env.UPLOAD_TMP_DIR!, 'prefix-bypass.zip')
    const { execFileSync } = await import('node:child_process')
    execFileSync('python3', ['-c', `import zipfile; z=zipfile.ZipFile(r"${maliciousArchive}","w"); z.writestr("../report-evil/escape.txt", "oops"); z.close()`])

    await expect(uploadReportArchive({ archivePath: maliciousArchive, uploadedBy: 1 })).rejects.toThrow('压缩包包含非法路径')
  })

  it('rejects invalid slug structure during metadata extraction', async () => {
    const archivePath = path.join(process.env.UPLOAD_TMP_DIR!, 'invalid-slug.zip')
    await makeZipFixture(archivePath, 'badname')

    await expect(uploadReportArchive({ archivePath, uploadedBy: 1 })).rejects.toThrow('目录名称不符合命名规范')
  })

  it('cleans temporary files after upload failure', async () => {
    const archivePath = path.join(process.env.UPLOAD_TMP_DIR!, 'cleanup.zip')
    await makeZipFixture(archivePath, 'chanel-spring-2027', false)

    await expect(uploadReportArchive({ archivePath, uploadedBy: 1 })).rejects.toThrow()
    expect(fs.existsSync(archivePath)).toBe(false)
  })

  it('returns empty report list from service initially', async () => {
    const reportService = await import('../src/modules/reports/report.service.js')
    expect(reportService.getReports()).toEqual([])
  })

  it('keeps upload limiter middleware callable', async () => {
    const middlewareModule = await import('../src/middleware/rate-limit.middleware.js')
    expect(typeof middlewareModule.uploadRateLimiter).toBe('function')
    expect(typeof middlewareModule.apiRateLimiter).toBe('function')
  })
})
