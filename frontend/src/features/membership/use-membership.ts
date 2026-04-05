import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getSessionUser } from '@/features/auth/protected-route'
import { getMembershipSnapshot } from '@/lib/api'
import type { FeatureAccessStatus, MembershipSnapshot } from '@/lib/types'

function formatResetTime(iso: string | null | undefined, language: string) {
  if (!iso) return null

  return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function useMembershipSnapshot() {
  const currentUser = getSessionUser()

  return useQuery({
    queryKey: ['membership-snapshot'],
    queryFn: getMembershipSnapshot,
    enabled: Boolean(currentUser),
  })
}

export function useMembershipStatus() {
  const { t, i18n } = useTranslation('common')
  const snapshotQuery = useMembershipSnapshot()
  const snapshot = snapshotQuery.data
  const aiAccess = snapshot?.features?.ai_chat
  const fashionAccess = snapshot?.features?.fashion_reports
  const isSubscriber = Boolean(snapshot?.subscription)
  const fallbackLimit = isSubscriber ? 300 : 10
  const rawLimit = Number(aiAccess?.limitCount)
  const aiLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : fallbackLimit
  const rawRemaining = Number(aiAccess?.remainingCount)
  const aiRemaining = Math.min(aiLimit, Math.max(0, Number.isFinite(rawRemaining) ? rawRemaining : aiLimit))
  const periodType = aiAccess?.usagePeriodType === 'daily' ? 'daily' : 'lifetime'
  const periodLabel = periodType === 'daily' ? t('membership.periodDaily') : t('membership.periodLifetime')
  const resetLabel = formatResetTime(aiAccess?.resetAt, i18n.language) ?? t('membership.resetFallback')
  const isLimitExceeded = aiAccess?.reason === 'limit_exceeded'

  const planLabel = isSubscriber ? t('membership.memberAccess') : t('membership.freeAccess')
  const planBadgeLabel = isSubscriber ? t('membership.badgeMember') : t('membership.badgeFree')
  const planDetail = isSubscriber
    ? t('membership.memberPlanDetail', { aiLimit, time: resetLabel })
    : t('membership.freePlanDetail', { aiLimit })

  const aiSummary = isSubscriber
    ? t('membership.memberSummary', { aiLimit })
    : t('membership.freeSummary', { remaining: aiRemaining, aiLimit })

  const reportsSummary = isSubscriber
    ? t('membership.reportsUnlockedSummary')
    : t('membership.reportsLockedSummary')

  const aiQuotaLabel = isLimitExceeded ? t('membership.quotaReached') : `${aiRemaining}/${aiLimit} ${periodLabel}`

  return useMemo(
    () => ({
      membershipSnapshot: snapshot as MembershipSnapshot | undefined,
      isLoading: snapshotQuery.isLoading,
      isFetching: snapshotQuery.isFetching,
      refetch: snapshotQuery.refetch,
      isSubscriber,
      planLabel,
      planBadgeLabel,
      planDetail,
      aiLimit,
      aiRemaining,
      aiSummary,
      reportsSummary,
      aiStatus: aiAccess as FeatureAccessStatus | undefined,
      fashionAccess: fashionAccess as FeatureAccessStatus | undefined,
      aiPeriodLabel: periodLabel,
      aiPeriodType: periodType as 'daily' | 'lifetime',
      hasSubscription: isSubscriber,
      isLimitExceeded,
      aiQuotaLabel,
      resetLabel,
    }),
    [
      aiAccess,
      aiLimit,
      aiQuotaLabel,
      aiRemaining,
      aiSummary,
      fashionAccess,
      isLimitExceeded,
      isSubscriber,
      periodLabel,
      periodType,
      planBadgeLabel,
      planDetail,
      planLabel,
      reportsSummary,
      resetLabel,
      snapshot,
      snapshotQuery.isFetching,
      snapshotQuery.isLoading,
      snapshotQuery.refetch,
    ],
  )
}
