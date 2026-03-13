import { findActiveSubscriptionByUserId } from '../subscriptions/subscription.repository.js'
import {
  getReportViewCount,
  hasViewedReport,
  recordReportView
} from './report-view.repository.js'
import { FREE_USER_VIEW_LIMIT, type ReportViewPermission } from '../../types/models.js'

/**
 * 检查用户是否为订阅用户
 */
export const isSubscriber = (userId: number): boolean => {
  const subscription = findActiveSubscriptionByUserId(userId)
  return subscription !== null
}

/**
 * 检查用户查看报告的权限
 */
export const checkReportViewPermission = (userId: number, reportId: number): ReportViewPermission => {
  // 订阅用户无限制
  if (isSubscriber(userId)) {
    return {
      canView: true,
      reason: 'subscriber',
      viewsRemaining: -1, // 无限制
      totalLimit: -1
    }
  }

  // 已查看过的报告可以重复查看
  if (hasViewedReport(userId, reportId)) {
    return {
      canView: true,
      reason: 'already_viewed',
      viewsRemaining: getRemainingViews(userId),
      totalLimit: FREE_USER_VIEW_LIMIT
    }
  }

  // 检查查看次数限制
  const viewCount = getReportViewCount(userId)
  const remainingViews = FREE_USER_VIEW_LIMIT - viewCount

  if (remainingViews <= 0) {
    return {
      canView: false,
      reason: 'limit_exceeded',
      viewsRemaining: 0,
      totalLimit: FREE_USER_VIEW_LIMIT
    }
  }

  return {
    canView: true,
    reason: 'allowed',
    viewsRemaining: remainingViews - 1, // 返回查看后的剩余次数
    totalLimit: FREE_USER_VIEW_LIMIT
  }
}

/**
 * 记录报告查看（如果用户有权查看）
 * @returns 是否成功记录（false 表示已查看过或无权限）
 */
export const viewReport = (userId: number, reportId: number): {
  success: boolean
  permission: ReportViewPermission
} => {
  const permission = checkReportViewPermission(userId, reportId)

  if (!permission.canView) {
    return { success: false, permission }
  }

  // 已查看过的报告不重复记录
  if (permission.reason === 'already_viewed' || permission.reason === 'subscriber') {
    return { success: true, permission }
  }

  const recorded = recordReportView(userId, reportId)
  return { success: recorded, permission }
}

/**
 * 获取用户剩余查看次数
 */
export const getRemainingViews = (userId: number): number => {
  if (isSubscriber(userId)) {
    return -1 // 无限制
  }

  const viewCount = getReportViewCount(userId)
  return Math.max(0, FREE_USER_VIEW_LIMIT - viewCount)
}