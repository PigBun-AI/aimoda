export type UserRole = 'admin' | 'editor' | 'viewer'

export interface UserRecord {
  id: number
  email: string
  passwordHash: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

export interface SafeUser {
  id: number
  email: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface AuthenticatedRequestUser {
  id: number
  email: string
  role: UserRole
}

export interface ReportRecord {
  id: number
  slug: string
  title: string
  brand: string
  season: string
  year: number
  lookCount: number
  path: string
  uploadedBy: number
  metadataJson: string | null
  createdAt: string
  updatedAt: string
}

export interface ReportMetadata {
  slug: string
  title: string
  brand: string
  season: string
  year: number
  lookCount: number
}

export type RedemptionCodeType = '1week' | '1month' | '3months' | '1year'
export type RedemptionCodeStatus = 'unused' | 'used' | 'expired'
export type SubscriptionStatus = 'active' | 'expired'
export type ActivityAction = 'login' | 'view_report' | 'redeem_code' | 'upload_report'

export interface RedemptionCodeRecord {
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

export interface SubscriptionRecord {
  id: number
  userId: number
  startsAt: string
  endsAt: string
  sourceCodeId: number
  status: SubscriptionStatus
  createdAt: string
}

export interface ActivityLogRecord {
  id: number
  userId: number
  action: ActivityAction
  createdAt: string
}
