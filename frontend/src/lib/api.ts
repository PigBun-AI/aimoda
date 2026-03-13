import type { AdminUser, AuthUser, DashboardData, LoginResponse, RedemptionCode, RedemptionCodeType, ReportDetail, ReportSummary, Subscription } from '@/lib/types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

const devDemoMode = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_MOCKS === 'true'

const authTokenStorageKey = 'fashion-report-access-token'

const rolePermissions: Record<AuthUser['role'], string[]> = {
  admin: ['reports:read', 'reports:write', 'users:manage'],
  editor: ['reports:read', 'reports:write'],
  viewer: ['reports:read'],
}

const mockUser: AuthUser = {
  id: 'u-admin',
  name: 'Fashion Admin',
  email: 'admin@fashion-report.local',
  role: 'admin',
  permissions: ['reports:read', 'reports:write', 'users:manage'],
}

const mockReports: ReportSummary[] = [
  {
    id: 'report-2026-aw-01',
    slug: 'multi-brand-fall-2026',
    title: '2026 秋冬女装趋势总览',
    brand: 'Multi Brand',
    season: 'AW26',
    status: 'published',
    updatedAt: '2026-03-12T10:00:00.000Z',
  },
  {
    id: 'report-2026-ss-02',
    slug: 'material-lab-spring-2026',
    title: '2026 春夏面料情绪图谱',
    brand: 'Material Lab',
    season: 'SS26',
    status: 'draft',
    updatedAt: '2026-03-10T08:30:00.000Z',
  },
  {
    id: 'report-2025-fw-03',
    slug: 'archive-studio-fall-2025',
    title: '2025 秋冬秀场造型复盘',
    brand: 'Archive Studio',
    season: 'FW25',
    status: 'archived',
    updatedAt: '2026-02-21T12:15:00.000Z',
  },
]

const mockAdminUsers: AdminUser[] = [
  {
    id: 'u-admin',
    name: 'Fashion Admin',
    email: 'admin@fashion-report.local',
    role: 'admin',
    permissions: ['reports:read', 'reports:write', 'users:manage'],
    lastActiveAt: '2026-03-12T16:20:00.000Z',
  },
  {
    id: 'u-editor',
    name: 'Trend Editor',
    email: 'editor@fashion-report.local',
    role: 'editor',
    permissions: ['reports:read', 'reports:write'],
    lastActiveAt: '2026-03-11T09:00:00.000Z',
  },
  {
    id: 'u-viewer',
    name: 'Buyer Viewer',
    email: 'buyer@fashion-report.local',
    role: 'viewer',
    permissions: ['reports:read'],
    lastActiveAt: '2026-03-09T18:40:00.000Z',
  },
]

function isApiEnvelope<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return 'success' in value
}

function getStoredAccessToken() {
  return window.localStorage.getItem(authTokenStorageKey)
}

export function setAccessToken(token: string) {
  window.localStorage.setItem(authTokenStorageKey, token)
}

export function clearAccessToken() {
  window.localStorage.removeItem(authTokenStorageKey)
}

function createHeaders(initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders)

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const token = getStoredAccessToken()

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return headers
}

function extractData<T>(payload: unknown): T {
  if (isApiEnvelope<T>(payload)) {
    if (!payload.success || typeof payload.data === 'undefined') {
      throw new ApiError(payload.error ?? 'API response is missing data', 500)
    }

    return payload.data
  }

  return payload as T
}

function normalizeAuthUser(input: LoginResponse['user']): AuthUser {
  return {
    id: String(input.id),
    name: input.email.split('@')[0],
    email: input.email,
    role: input.role,
    permissions: rolePermissions[input.role],
  }
}

async function request<T>(path: string, options?: RequestInit, demoFallback?: T): Promise<T> {
  try {
    const response = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: createHeaders(options?.headers),
    })

    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}`, response.status)
    }

    const payload = (await response.json()) as unknown
    return extractData<T>(payload)
  } catch (error) {
    if (devDemoMode && typeof demoFallback !== 'undefined') {
      return demoFallback
    }

    if (error instanceof ApiError) {
      throw error
    }

    throw new ApiError('Network request failed', 500)
  }
}

export async function login(payload: { email: string; password: string }): Promise<AuthUser> {
  const data = await request<LoginResponse>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    {
      user: {
        id: 1,
        email: mockUser.email,
        role: mockUser.role,
        createdAt: '2026-03-12T16:20:00.000Z',
        updatedAt: '2026-03-12T16:20:00.000Z',
      },
      tokens: {
        accessToken: 'demo-access-token',
        refreshToken: 'demo-refresh-token',
      },
    }
  )

  setAccessToken(data.tokens.accessToken)
  return normalizeAuthUser(data.user)
}

export async function getCurrentUser(): Promise<AuthUser> {
  const data = await request<LoginResponse['user']>('/api/auth/me', undefined, {
    id: 1,
    email: mockUser.email,
    role: mockUser.role,
    createdAt: '2026-03-12T16:20:00.000Z',
    updatedAt: '2026-03-12T16:20:00.000Z',
  })

  return normalizeAuthUser(data)
}

export async function getReports(): Promise<ReportSummary[]> {
  return request('/api/reports', undefined, mockReports)
}

export async function getReportById(id: string): Promise<ReportDetail> {
  const data = await request<{
    id: number
    slug: string
    title: string
    brand: string
    season: string
    year: number
    lookCount: number
    path: string
    createdAt: string
    updatedAt: string
  }>(`/api/reports/${id}`)

  // Construct ReportDetail from available data
  return {
    id: String(data.id),
    slug: data.slug,
    title: data.title,
    brand: data.brand,
    season: data.season,
    status: 'draft',
    updatedAt: data.updatedAt,
    description: `${data.brand} ${data.season} ${data.year} RTW 趋势报告，包含 ${data.lookCount} 个造型`,
    iframeUrl: `/reports/${data.slug}/index.html`,
    tags: [data.brand, data.season, String(data.year), 'RTW']
  }
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  return request('/api/users', undefined, mockAdminUsers)
}

export async function register(payload: { email: string; password: string }): Promise<AuthUser> {
  const data = await request<LoginResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  setAccessToken(data.tokens.accessToken)
  return normalizeAuthUser(data.user)
}

export async function getDashboard(): Promise<DashboardData> {
  return request('/api/admin/dashboard')
}

export async function generateRedemptionCodes(payload: { type: RedemptionCodeType; count: number }): Promise<RedemptionCode[]> {
  return request('/api/admin/redemption-codes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getRedemptionCodes(): Promise<RedemptionCode[]> {
  return request('/api/admin/redemption-codes')
}

export async function redeemCode(payload: { code: string }): Promise<{ subscription: Subscription }> {
  return request('/api/redemption-codes/redeem', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getMySubscription(): Promise<Subscription | null> {
  return request('/api/users/me/subscription')
}
