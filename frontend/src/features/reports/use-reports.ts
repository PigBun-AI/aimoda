import { useQuery } from '@tanstack/react-query'

import { getReports } from '@/lib/api'

export const reportsQueryKey = (page = 1, limit = 12) => ['reports', page, limit] as const

export function useReports(page = 1, limit = 12) {
  return useQuery({
    queryKey: reportsQueryKey(page, limit),
    queryFn: () => getReports(page, limit),
  })
}
