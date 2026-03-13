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
}

export interface ReportDetail extends ReportSummary {
  description: string
  iframeUrl: string
  tags: string[]
}

export interface AdminUser extends AuthUser {
  lastActiveAt: string
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
