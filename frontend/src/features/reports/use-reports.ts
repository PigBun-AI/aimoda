import { useQuery } from '@tanstack/react-query'

import { getReports } from '@/lib/api'

export const reportsQueryKey = (page = 1, limit = 12, q = '') => ['reports', page, limit, q] as const

export function useReports(page = 1, limit = 12, q = '') {
  return useQuery({
    queryKey: reportsQueryKey(page, limit, q),
    queryFn: () => getReports(page, limit, q),
  })
}
