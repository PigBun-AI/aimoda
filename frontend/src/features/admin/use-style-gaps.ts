import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getStyleGaps, updateStyleGap } from '@/lib/api'
import type { GetStyleGapsParams, UpdateStyleGapParams } from '@/lib/types'

export const styleGapsQueryKey = ['admin-style-gaps'] as const

export function useStyleGaps(params: GetStyleGapsParams) {
  return useQuery({
    queryKey: [...styleGapsQueryKey, params],
    queryFn: () => getStyleGaps(params),
  })
}

export function useUpdateStyleGap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ signalId, payload }: UpdateStyleGapParams) => updateStyleGap(signalId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: styleGapsQueryKey })
    },
  })
}
