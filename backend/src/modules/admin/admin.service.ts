import { countUsers, countUsersByRole } from '../users/user.repository.js'
import { getSubscriptionStats } from '../subscriptions/subscription.service.js'
import { getDailyActivePercent, getActivityTrend } from '../activity/activity.service.js'

export const getDashboardData = () => ({
  totalUsers: countUsers(),
  roleDistribution: countUsersByRole(),
  subscriptionStats: getSubscriptionStats(),
  dauPercent: getDailyActivePercent(),
  activityTrend: getActivityTrend(30),
})
