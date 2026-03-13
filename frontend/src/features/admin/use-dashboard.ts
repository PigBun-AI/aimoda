import { useQuery } from '@tanstack/react-query'

import { getDashboard } from '@/lib/api'

export function useDashboard() {
  return useQuery({ queryKey: ['admin-dashboard'], queryFn: getDashboard })
}
