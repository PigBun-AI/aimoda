import { findActiveSubscriptionByUserId, getSubscriptionStats } from './subscription.repository.js'

export const getUserSubscription = (userId: number) => findActiveSubscriptionByUserId(userId)

export { getSubscriptionStats }
