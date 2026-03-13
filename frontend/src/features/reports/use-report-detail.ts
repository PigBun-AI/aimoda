import { useQuery } from '@tanstack/react-query'

import { getReportById } from '@/lib/api'

export function useReportDetail(reportId: string) {
  return useQuery({
    queryKey: ['report-detail', reportId],
    queryFn: () => getReportById(reportId),
    enabled: Boolean(reportId),
  })
}
