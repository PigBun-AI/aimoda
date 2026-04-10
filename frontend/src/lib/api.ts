import type {
  AdminUser,
  AdminGallerySummary,
  AdminGalleriesPage,
  AdminReportsPage,
  AuthUser,
  DashboardData,
  GetStyleGapsParams,
  StyleGapEvent,
  StyleGapStats,
  LoginResponse,
  RedemptionCode,
  RedemptionCodeType,
  ReportDetail,
  ReportSummary,
  StyleGapListResponse,
  Subscription,
  UpdateStyleGapPayload,
  UpdateAdminGalleryPayload,
  UpdateAdminReportPayload,
  MembershipSnapshot,
} from '@/lib/types'

export class ApiError extends Error {
  status: number
  data?: unknown

  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) {
    return error.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

const devDemoMode = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_MOCKS === 'true'

const authTokenStorageKey = 'fashion-report-access-token'
const authSessionStorageKey = 'fashion-report-session'
const refreshableAuthPaths = new Set([
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/logout-all',
])
let refreshPromise: Promise<boolean> | null = null

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

export function clearClientAuthState() {
  clearAccessToken()
  window.localStorage.removeItem(authSessionStorageKey)
}

export function persistAuthUser(user: AuthUser) {
  window.localStorage.setItem(authSessionStorageKey, JSON.stringify(user))
}

export function handleUnauthorizedSession() {
  clearClientAuthState()
  window.location.reload()
}

export function createAuthHeaders(initHeaders?: HeadersInit, body?: BodyInit | null) {
  const headers = new Headers(initHeaders)

  const shouldSetJsonContentType =
    typeof body === 'string'
    || body instanceof URLSearchParams

  if (shouldSetJsonContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const token = getStoredAccessToken()

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return headers
}

function shouldAttemptRefresh(path: string) {
  if (refreshableAuthPaths.has(path)) {
    return true
  }

  return path.startsWith('/api/') && !path.startsWith('/api/auth/')
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })

      if (!response.ok) {
        return false
      }

      const payload = (await response.json()) as unknown
      const data = extractData<LoginResponse>(payload)
      const normalizedUser = normalizeAuthUser(data.user)
      setAccessToken(data.tokens.accessToken)
      persistAuthUser(normalizedUser)
      return true
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function fetchWithAuth(
  path: string,
  options?: RequestInit,
  config?: {
    allowRefresh?: boolean
    suppressAutoLogout?: boolean
  },
): Promise<Response> {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: createAuthHeaders(options?.headers, options?.body),
  })

  if (response.status !== 401) {
    return response
  }

  const shouldRefresh = config?.allowRefresh ?? shouldAttemptRefresh(path)
  if (!shouldRefresh || path === '/api/auth/refresh') {
    if (!config?.suppressAutoLogout) {
      handleUnauthorizedSession()
    }
    return response
  }

  const refreshed = await refreshAccessToken()
  if (!refreshed) {
    if (!config?.suppressAutoLogout) {
      handleUnauthorizedSession()
    }
    return response
  }

  return fetch(path, {
    credentials: 'include',
    ...options,
    headers: createAuthHeaders(options?.headers, options?.body),
  })
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
  const displayName =
    input.email?.split('@')[0]
    ?? (input.phone ? `USER ${input.phone.slice(-4)}` : `USER ${input.id}`)

  return {
    id: String(input.id),
    name: displayName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    role: input.role,
    permissions: rolePermissions[input.role],
  }
}

async function request<T>(path: string, options?: RequestInit, demoFallback?: T): Promise<T> {
  try {
    const shouldSuppressAutoLogout =
      path === '/api/auth/login'
      || path === '/api/auth/register'
      || path === '/api/auth/sms/login'
      || path === '/api/auth/sms/register'
      || path === '/api/auth/sms/send-code'

    const response = await fetchWithAuth(path, options, {
      allowRefresh: !shouldSuppressAutoLogout,
      suppressAutoLogout: shouldSuppressAutoLogout,
    })

    if (!response.ok) {
      let payload: ApiResponse<unknown> | null = null
      try {
        payload = (await response.json()) as ApiResponse<unknown>
      } catch {
        payload = null
      }
      throw new ApiError(
        payload?.error ?? `Request failed with status ${response.status}`,
        response.status,
        payload?.data,
      )
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

  const normalizedUser = normalizeAuthUser(data.user)
  setAccessToken(data.tokens.accessToken)
  persistAuthUser(normalizedUser)
  return normalizedUser
}

export async function getCurrentUser(): Promise<AuthUser> {
  const data = await request<LoginResponse['user']>('/api/auth/me', undefined, {
    id: 1,
    email: mockUser.email,
    role: mockUser.role,
    createdAt: '2026-03-12T16:20:00.000Z',
    updatedAt: '2026-03-12T16:20:00.000Z',
  })

  const normalizedUser = normalizeAuthUser(data)
  persistAuthUser(normalizedUser)
  return normalizedUser
}

export async function sendSmsCode(payload: { phone: string; purpose: 'login' | 'register' }): Promise<void> {
  await request('/api/auth/sms/send-code', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function loginWithSms(payload: { phone: string; code: string }): Promise<AuthUser> {
  const data = await request<LoginResponse>('/api/auth/sms/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const normalizedUser = normalizeAuthUser(data.user)
  setAccessToken(data.tokens.accessToken)
  persistAuthUser(normalizedUser)
  return normalizedUser
}

export async function register(payload: { email: string; password: string }): Promise<AuthUser> {
  const data = await request<LoginResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const normalizedUser = normalizeAuthUser(data.user)
  setAccessToken(data.tokens.accessToken)
  persistAuthUser(normalizedUser)
  return normalizedUser
}

export async function registerWithSms(payload: { phone: string; code: string }): Promise<AuthUser> {
  const data = await request<LoginResponse>('/api/auth/sms/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const normalizedUser = normalizeAuthUser(data.user)
  setAccessToken(data.tokens.accessToken)
  persistAuthUser(normalizedUser)
  return normalizedUser
}

export interface PaginatedReports {
  reports: ReportSummary[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export async function getReports(page = 1, limit = 12): Promise<PaginatedReports> {
  const response = await fetchWithAuth(`/api/reports?page=${page}&limit=${limit}`)

  if (!response.ok) {
    let payload: ApiResponse<unknown> | null = null
    try {
      payload = (await response.json()) as ApiResponse<unknown>
    } catch {
      payload = null
    }
    throw new ApiError(
      payload?.error ?? `Request failed with status ${response.status}`,
      response.status,
      payload?.data,
    )
  }

  const payload = await response.json() as {
    success: boolean
    data: ReportSummary[]
    meta: { total: number; page: number; limit: number; totalPages: number }
  }

  if (!payload.success || !payload.data) {
    throw new ApiError('Failed to fetch reports', 500)
  }

  // Transform backend data to include coverImageUrl from OSS
  return {
    reports: payload.data.map((report: ReportSummary & { coverUrl?: string; previewUrl?: string; leadExcerpt?: string | null }) => ({
      ...report,
      coverImageUrl: report.coverUrl || `/report-files/${report.slug}/cover.jpg`,
    })),
    ...payload.meta
  }
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
    indexUrl: string
    previewUrl?: string
    overviewUrl: string | null
    coverUrl: string | null
    ossPrefix: string
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
    status: 'published',
    updatedAt: data.updatedAt,
    coverImageUrl: data.coverUrl || `/report-files/${data.slug}/cover.jpg`,
    description: `${data.brand} ${data.season} ${data.year} RTW 趋势报告，包含 ${data.lookCount} 个造型`,
    iframeUrl: data.previewUrl || data.indexUrl || `/report-files/${data.slug}/index.html`,
    tags: [data.brand, data.season, String(data.year), 'RTW']
  }
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  return request('/api/users', undefined, mockAdminUsers)
}

export async function getDashboard(): Promise<DashboardData> {
  return request('/api/admin/dashboard')
}

export async function getStyleGaps(params: GetStyleGapsParams): Promise<StyleGapListResponse> {
  const searchParams = new URLSearchParams()
  searchParams.set('status', params.status)
  if (params.q) searchParams.set('q', params.q)
  if (typeof params.minHits === 'number') searchParams.set('min_hits', String(params.minHits))
  if (params.sort) searchParams.set('sort', params.sort)
  if (params.order) searchParams.set('order', params.order)
  if (typeof params.limit === 'number') searchParams.set('limit', String(params.limit))
  if (typeof params.offset === 'number') searchParams.set('offset', String(params.offset))

  const data = await request<{
    items: Array<{
      id: string
      query_normalized: string
      query_raw: string
      source: string
      trigger_tool: string
      search_stage: string
      status: 'open' | 'covered' | 'ignored'
      total_hits: number
      unique_sessions: number
      linked_style_name: string | null
      resolution_note: string
      resolved_by: string
      first_seen_at: string | null
      last_seen_at: string | null
      covered_at?: string | null
      latest_context: Record<string, unknown>
    }>
    total: number
    limit: number
    offset: number
    status: 'open' | 'covered' | 'ignored'
    q?: string
    sort?: string
    order?: 'asc' | 'desc'
    min_hits: number
  }>(`/api/admin/style-gaps?${searchParams.toString()}`, undefined, {
    items: [],
    total: 0,
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
    status: params.status,
    q: params.q ?? '',
    sort: params.sort ?? 'total_hits',
    order: params.order ?? 'desc',
    min_hits: params.minHits ?? 1,
  })

  return {
    items: data.items.map((item) => ({
      id: item.id,
      queryNormalized: item.query_normalized,
      queryRaw: item.query_raw,
      source: item.source,
      triggerTool: item.trigger_tool,
      searchStage: item.search_stage,
      status: item.status,
      totalHits: item.total_hits,
      uniqueSessions: item.unique_sessions,
      linkedStyleName: item.linked_style_name,
      resolutionNote: item.resolution_note,
      resolvedBy: item.resolved_by,
      firstSeenAt: item.first_seen_at,
      lastSeenAt: item.last_seen_at,
      coveredAt: item.covered_at ?? null,
      latestContext: item.latest_context ?? {},
    })),
    total: data.total,
    limit: data.limit,
    offset: data.offset,
    status: data.status,
    q: data.q,
    sort: data.sort,
    order: data.order,
    minHits: data.min_hits,
  }
}

export async function updateStyleGap(signalId: string, payload: UpdateStyleGapPayload) {
  const data = await request<{
    id: string
    query_normalized: string
    query_raw: string
    source: string
    trigger_tool: string
    search_stage: string
    status: 'open' | 'covered' | 'ignored'
    total_hits: number
    unique_sessions: number
    linked_style_name: string | null
    resolution_note: string
    resolved_by: string
    first_seen_at: string | null
    last_seen_at: string | null
    covered_at: string | null
    latest_context: Record<string, unknown>
  }>(`/api/admin/style-gaps/${signalId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: payload.status,
      linked_style_name: payload.linkedStyleName,
      resolution_note: payload.resolutionNote,
      resolved_by: payload.resolvedBy,
    }),
  })

  return {
    id: data.id,
    queryNormalized: data.query_normalized,
    queryRaw: data.query_raw,
    source: data.source,
    triggerTool: data.trigger_tool,
    searchStage: data.search_stage,
    status: data.status,
    totalHits: data.total_hits,
    uniqueSessions: data.unique_sessions,
    linkedStyleName: data.linked_style_name,
    resolutionNote: data.resolution_note,
    resolvedBy: data.resolved_by,
    firstSeenAt: data.first_seen_at,
    lastSeenAt: data.last_seen_at,
    coveredAt: data.covered_at,
    latestContext: data.latest_context ?? {},
  }
}

export async function getStyleGapEvents(signalId: string, limit = 10): Promise<StyleGapEvent[]> {
  const searchParams = new URLSearchParams()
  searchParams.set('limit', String(Math.max(1, Math.min(limit, 50))))

  const data = await request<Array<{
    id: string
    signal_id: string
    query_raw: string
    query_normalized: string
    session_id: string | null
    user_id: number | null
    source: string
    trigger_tool: string
    search_stage: string
    context: Record<string, unknown>
    created_at: string | null
  }>>(`/api/admin/style-gaps/${signalId}/events?${searchParams.toString()}`, undefined, [])

  return data.map((item) => ({
    id: item.id,
    signalId: item.signal_id,
    queryRaw: item.query_raw,
    queryNormalized: item.query_normalized,
    sessionId: item.session_id,
    userId: item.user_id,
    source: item.source,
    triggerTool: item.trigger_tool,
    searchStage: item.search_stage,
    context: item.context ?? {},
    createdAt: item.created_at,
  }))
}

function getRecentCountFromItems(items: StyleGapListResponse['items']) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return items.reduce((count, item) => {
    const timestamp = item.firstSeenAt ? Date.parse(item.firstSeenAt) : Number.NaN
    if (!Number.isNaN(timestamp) && timestamp >= sevenDaysAgo) {
      return count + 1
    }
    return count
  }, 0)
}

export async function getStyleGapStats(): Promise<StyleGapStats> {
  try {
    const data = await request<{
      open: number
      covered: number
      ignored: number
      recent_new: number
    }>('/api/admin/style-gaps/stats')

    return {
      open: data.open,
      covered: data.covered,
      ignored: data.ignored,
      recentNew: data.recent_new,
    }
  } catch {
    const [open, covered, ignored] = await Promise.all([
      getStyleGaps({ status: 'open', limit: 100, offset: 0, sort: 'first_seen', order: 'desc' }),
      getStyleGaps({ status: 'covered', limit: 100, offset: 0, sort: 'first_seen', order: 'desc' }),
      getStyleGaps({ status: 'ignored', limit: 100, offset: 0, sort: 'first_seen', order: 'desc' }),
    ])

    return {
      open: open.total,
      covered: covered.total,
      ignored: ignored.total,
      recentNew: getRecentCountFromItems(open.items) + getRecentCountFromItems(covered.items) + getRecentCountFromItems(ignored.items),
    }
  }
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

export async function getMembershipSnapshot(): Promise<MembershipSnapshot> {
  return request('/api/users/me/membership')
}

export async function deleteReport(id: string): Promise<void> {
  await request(`/api/reports/${id}`, {
    method: 'DELETE',
  })
}

export async function getAdminReports(): Promise<ReportSummary[]> {
  const result = await getReports(1, 100) // Admin sees all reports
  return result.reports
}

export async function getAdminReportsPage(params: {
  page?: number
  limit?: number
  q?: string
}): Promise<AdminReportsPage> {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params.page ?? 1))
  searchParams.set('limit', String(params.limit ?? 12))
  if (params.q?.trim()) searchParams.set('q', params.q.trim())

  const data = await request<{
    items: Array<ReportSummary & { coverUrl?: string | null; leadExcerpt?: string | null }>
    total: number
    page: number
    limit: number
    totalPages: number
    q: string
  }>(`/api/admin/reports?${searchParams.toString()}`)

  return {
    items: data.items.map((report) => ({
      ...report,
      coverImageUrl: report.coverUrl || `/report-files/${report.slug}/cover.jpg`,
    })),
    total: data.total,
    page: data.page,
    limit: data.limit,
    totalPages: data.totalPages,
    q: data.q,
  }
}

export async function updateAdminReport(id: string, payload: UpdateAdminReportPayload): Promise<ReportSummary> {
  const data = await request<ReportSummary & { coverUrl?: string | null }>(`/api/admin/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: payload.title,
      brand: payload.brand,
      season: payload.season,
      year: payload.year,
      cover_url: payload.coverUrl,
      lead_excerpt: payload.leadExcerpt,
    }),
  })

  return {
    ...data,
    coverImageUrl: data.coverUrl || `/report-files/${data.slug}/cover.jpg`,
  }
}

export async function getAdminGalleriesPage(params: {
  page?: number
  limit?: number
  q?: string
  status?: string
}): Promise<AdminGalleriesPage> {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params.page ?? 1))
  searchParams.set('limit', String(params.limit ?? 12))
  if (params.q?.trim()) searchParams.set('q', params.q.trim())
  if (params.status?.trim()) searchParams.set('status', params.status.trim())

  const data = await request<{
    items: Array<{
      id: string
      title: string
      description: string
      category: string
      tags: string[]
      cover_url: string
      status: string
      image_count: number
      created_at: string
      updated_at: string
    }>
    total: number
    page: number
    limit: number
    totalPages: number
    q: string
    status: string
  }>(`/api/admin/galleries?${searchParams.toString()}`)

  return {
    items: data.items.map((item): AdminGallerySummary => ({
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      tags: item.tags,
      coverUrl: item.cover_url,
      status: item.status,
      imageCount: item.image_count,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
    total: data.total,
    page: data.page,
    limit: data.limit,
    totalPages: data.totalPages,
    q: data.q,
    status: data.status,
  }
}

export async function updateAdminGallery(id: string, payload: UpdateAdminGalleryPayload): Promise<AdminGallerySummary> {
  const data = await request<{
    id: string
    title: string
    description: string
    category: string
    tags: string[]
    cover_url: string
    status: string
    image_count: number
    created_at: string
    updated_at: string
  }>(`/api/admin/galleries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: payload.title,
      description: payload.description,
      category: payload.category,
      tags: payload.tags,
      cover_url: payload.coverUrl,
      status: payload.status,
    }),
  })

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    category: data.category,
    tags: data.tags,
    coverUrl: data.cover_url,
    status: data.status,
    imageCount: data.image_count,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }
}
