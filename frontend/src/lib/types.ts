export type UserRole = 'admin' | 'editor' | 'viewer'

export interface AuthUser {
  id: string
  name: string
  email: string | null
  phone?: string | null
  role: UserRole
  permissions: string[]
}

export interface LoginResponse {
  user: {
    id: number
    email: string | null
    phone?: string | null
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
  year?: number
  status: 'draft' | 'published' | 'archived'
  updatedAt: string
  coverImageUrl: string
  previewUrl?: string
  leadExcerpt?: string | null
}

export interface AdminReportsPage {
  items: ReportSummary[]
  total: number
  page: number
  limit: number
  totalPages: number
  q: string
}

export interface UpdateAdminReportPayload {
  title?: string
  brand?: string
  season?: string
  year?: number
  coverUrl?: string
  leadExcerpt?: string | null
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

export interface AdminGallerySummary {
  id: string
  title: string
  description: string
  category: string
  tags: string[]
  coverUrl: string
  status: string
  imageCount: number
  createdAt: string
  updatedAt: string
}

export interface AdminGalleriesPage {
  items: AdminGallerySummary[]
  total: number
  page: number
  limit: number
  totalPages: number
  q: string
  status: string
}

export interface UpdateAdminGalleryPayload {
  title?: string
  description?: string
  category?: string
  tags?: string[]
  coverUrl?: string
  status?: string
}

export type FeatureCode = 'ai_chat' | 'fashion_reports' | 'inspiration' | 'image_generation' | 'video_generation'

export type UsagePeriodType = 'daily' | 'lifetime' | 'none'

export interface FeatureAccessStatus {
  featureCode: FeatureCode
  allowed: boolean
  reason: 'allowed' | 'limit_exceeded' | 'subscription_required' | 'admin' | 'free_tier' | 'subscriber'
  usagePeriodType: UsagePeriodType
  periodKey: string | null
  usedCount: number
  limitCount: number
  remainingCount: number
  resetAt?: string | null
}

export interface MembershipSnapshot {
  subscription: Subscription | null
  features: Record<FeatureCode, FeatureAccessStatus>
}
