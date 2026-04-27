import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { getTrendFlows } from '@/lib/api'

export const trendFlowsQueryKey = (page = 1, limit = 12, q = '') => ['trend-flow', page, limit, q] as const
export const infiniteTrendFlowsQueryKey = (limit = 12, q = '') => ['trend-flow', 'infinite', limit, q] as const

export function useTrendFlows(page = 1, limit = 12, q = '') {
  return useQuery({
    queryKey: trendFlowsQueryKey(page, limit, q),
    queryFn: () => getTrendFlows(page, limit, q),
  })
}

export function useInfiniteTrendFlows(limit = 12, q = '') {
  return useInfiniteQuery({
    queryKey: infiniteTrendFlowsQueryKey(limit, q),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => getTrendFlows(pageParam, limit, q),
    getNextPageParam: (lastPage) => (
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined
    ),
  })
}
