import { useQuery } from '@tanstack/react-query'

import { getReports } from '@/lib/api'

export const reportsQueryKey = ['reports'] as const

export function useReports() {
  return useQuery({
    queryKey: reportsQueryKey,
    queryFn: getReports,
  })
}
