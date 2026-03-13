import { useQuery, useMutation } from '@tanstack/react-query'

import { redeemCode, getMySubscription } from '@/lib/api'

export function useRedeemCode() {
  return useMutation({ mutationFn: redeemCode })
}

export function useMySubscription() {
  return useQuery({ queryKey: ['my-subscription'], queryFn: getMySubscription })
}
