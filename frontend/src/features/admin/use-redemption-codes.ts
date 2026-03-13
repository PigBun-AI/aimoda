import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { getRedemptionCodes, generateRedemptionCodes } from '@/lib/api'

export function useRedemptionCodes() {
  return useQuery({ queryKey: ['admin-redemption-codes'], queryFn: getRedemptionCodes })
}

export function useGenerateCodes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: generateRedemptionCodes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-redemption-codes'] }),
  })
}
