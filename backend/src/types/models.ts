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

// 报告查看记录 - 用于免费用户查看限制
export interface ReportViewRecord {
  id: number
  userId: number
  reportId: number
  viewedAt: string
}

// 会话记录 - 用于单点登录控制
export interface SessionRecord {
  id: number
  userId: number
  refreshTokenHash: string
  deviceInfo: string | null
  ipAddress: string | null
  userAgent: string | null
  lastActiveAt: string
  expiresAt: string
  createdAt: string
}

// 设备信息（存储为 JSON）
export interface DeviceInfo {
  device?: string      // 设备类型：mobile, tablet, desktop
  os?: string          // 操作系统：iOS, Android, Windows, macOS
  browser?: string     // 浏览器：Chrome, Safari, Firefox
  deviceName?: string  // 用户友好的设备名称
}

// 免费用户查看限制配置
export const FREE_USER_VIEW_LIMIT = 3

// 用户查看报告权限结果
export interface ReportViewPermission {
  canView: boolean
  reason: 'allowed' | 'limit_exceeded' | 'already_viewed' | 'subscriber'
  viewsRemaining: number
  totalLimit: number
}
