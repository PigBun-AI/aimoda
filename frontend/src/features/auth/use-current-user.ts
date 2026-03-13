import { useQuery } from '@tanstack/react-query'

import { getCurrentUser } from '@/lib/api'

export const authQueryKey = ['auth', 'current-user'] as const

export function useCurrentUser() {
  return useQuery({
    queryKey: authQueryKey,
    queryFn: getCurrentUser,
  })
}
