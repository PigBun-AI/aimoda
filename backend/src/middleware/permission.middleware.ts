import { NextFunction, Request, Response } from 'express'
import { findActiveSubscriptionByUserId } from '../modules/subscriptions/subscription.repository.js'
import {
  getReportViewCount,
  hasViewedReport,
  recordReportView
} from '../modules/report-views/report-view.repository.js'
import { FREE_USER_VIEW_LIMIT } from '../types/models.js'

/**
 * 检查用户是否有订阅
 */
export const hasActiveSubscription = (userId: number): boolean => {
  const subscription = findActiveSubscriptionByUserId(userId)
  return subscription !== null
}

/**
 * 检查报告查看权限中间件
 * - 订阅用户：无限查看
 * - 管理员/编辑：无限查看
 * - 免费用户：限制 3 篇，已查看的可重复查看
 */
export const checkReportViewPermission = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  const user = request.user
  const reportId = Number(request.params.id)

  if (!user) {
    response.status(401).json({ success: false, error: '请先登录' })
    return
  }

  // 管理员和编辑无限权限
  if (user.role === 'admin' || user.role === 'editor') {
    next()
    return
  }

  // 订阅用户无限权限
  if (hasActiveSubscription(user.id)) {
    next()
    return
  }

  // 已查看过的文章可以重复查看
  if (hasViewedReport(user.id, reportId)) {
    next()
    return
  }

  // 检查查看次数限制
  const viewCount = getReportViewCount(user.id)

  if (viewCount >= FREE_USER_VIEW_LIMIT) {
    response.status(403).json({
      success: false,
      error: '已达到免费查看上限',
      code: 'VIEW_LIMIT_EXCEEDED',
      data: {
        limit: FREE_USER_VIEW_LIMIT,
        current: viewCount,
        viewsRemaining: 0
      }
    })
    return
  }

  // 记录查看行为
  recordReportView(user.id, reportId)

  next()
}

/**
 * 获取用户查看状态
 */
export const getViewStatus = (userId: number, role: string) => {
  // 管理员和编辑无限制
  if (role === 'admin' || role === 'editor') {
    return {
      isUnlimited: true,
      hasSubscription: false,
      viewsUsed: 0,
      viewsRemaining: -1,
      totalLimit: -1
    }
  }

  // 订阅用户无限制
  const hasSubscription = hasActiveSubscription(userId)
  if (hasSubscription) {
    return {
      isUnlimited: true,
      hasSubscription: true,
      viewsUsed: 0,
      viewsRemaining: -1,
      totalLimit: -1
    }
  }

  // 免费用户
  const viewsUsed = getReportViewCount(userId)
  return {
    isUnlimited: false,
    hasSubscription: false,
    viewsUsed,
    viewsRemaining: Math.max(0, FREE_USER_VIEW_LIMIT - viewsUsed),
    totalLimit: FREE_USER_VIEW_LIMIT
  }
}