import { useQuery } from '@tanstack/react-query'

import { getTrendFlows } from '@/lib/api'

export const trendFlowsQueryKey = (page = 1, limit = 12, q = '') => ['trend-flow', page, limit, q] as const

export function useTrendFlows(page = 1, limit = 12, q = '') {
  return useQuery({
    queryKey: trendFlowsQueryKey(page, limit, q),
    queryFn: () => getTrendFlows(page, limit, q),
  })
}
