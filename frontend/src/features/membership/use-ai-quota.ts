import { useMembershipStatus } from '@/features/membership/use-membership'

export function useAiQuota() {
  const { aiStatus, aiLimit, aiRemaining, aiPeriodType } = useMembershipStatus()

  return {
    usage: aiStatus?.usedCount ?? 0,
    limit: aiLimit,
    remaining: aiRemaining,
    periodType: aiPeriodType,
    periodKey: aiStatus?.periodKey ?? null,
    isExhausted: aiRemaining <= 0,
    recordUsage: () => undefined,
  }
}
