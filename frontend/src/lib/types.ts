export type UserRole = 'admin' | 'editor' | 'viewer'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  permissions: string[]
}

export interface LoginResponse {
  user: {
    id: number
    email: string
    role: UserRole
    createdAt: string
    updatedAt: string
  }
  tokens: {
    accessToken: string
    refreshToken: string
  }
}

export interface ReportSummary {
  id: string
  slug: string
  title: string
  brand: string
  season: string
  status: 'draft' | 'published' | 'archived'
  updatedAt: string
  coverImageUrl: string
}

export interface ReportDetail extends ReportSummary {
  description: string
  iframeUrl: string
  tags: string[]
}

export interface AdminUser extends AuthUser {
  lastActiveAt: string
}

export type StyleGapStatus = 'open' | 'covered' | 'ignored'

export interface StyleGapSignal {
  id: string
  queryNormalized: string
  queryRaw: string
  source: string
  triggerTool: string
  searchStage: string
  status: StyleGapStatus
  totalHits: number
  uniqueSessions: number
  linkedStyleName: string | null
  resolutionNote: string
  resolvedBy: string
  firstSeenAt: string | null
  lastSeenAt: string | null
  coveredAt: string | null
  latestContext: Record<string, unknown>
}

export interface StyleGapEvent {
  id: string
  signalId: string
  queryRaw: string
  queryNormalized: string
  sessionId: string | null
  userId: number | null
  source: string
  triggerTool: string
  searchStage: string
  context: Record<string, unknown>
  createdAt: string | null
}

export interface StyleGapListResponse {
  items: StyleGapSignal[]
  total: number
  limit: number
  offset: number
  status: StyleGapStatus
  q?: string
  sort?: string
  order?: 'asc' | 'desc'
  minHits: number
}

export interface StyleGapStats {
  open: number
  covered: number
  ignored: number
  recentNew: number
}

export interface GetStyleGapsParams {
  status: StyleGapStatus
  q?: string
  minHits?: number
  sort?: 'total_hits' | 'last_seen' | 'first_seen'
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface UpdateStyleGapPayload {
  status: StyleGapStatus
  linkedStyleName?: string
  resolutionNote?: string
  resolvedBy?: string
}

export interface UpdateStyleGapParams {
  signalId: string
  payload: UpdateStyleGapPayload
}

export interface GetStyleGapEventsParams {
  signalId: string
  limit?: number
}

export type RedemptionCodeType = '1week' | '1month' | '3months' | '1year'
export type RedemptionCodeStatus = 'unused' | 'used' | 'expired'

export interface DashboardData {
  totalUsers: number
  roleDistribution: Record<string, number>
  subscriptionStats: {
    total: number
    active: number
    byType: Record<RedemptionCodeType, number>
  }
  dauPercent: number
  activityTrend: Array<{ date: string; count: number }>
}

export interface RedemptionCode {
  id: number
  code: string
  type: RedemptionCodeType
  status: RedemptionCodeStatus
  createdBy: number
  usedBy: number | null
  createdAt: string
  usedAt: string | null
  expiresAt: string
}

export interface Subscription {
  id: number
  startsAt: string
  endsAt: string
  status: 'active' | 'expired'
}
