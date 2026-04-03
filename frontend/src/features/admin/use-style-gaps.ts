import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getStyleGapEvents, getStyleGaps, getStyleGapStats, updateStyleGap } from '@/lib/api'
import type { GetStyleGapsParams, UpdateStyleGapParams } from '@/lib/types'

export const styleGapsQueryKey = ['admin-style-gaps'] as const
export const styleGapStatsQueryKey = ['admin-style-gaps-stats'] as const
export const styleGapEventsQueryKey = (signalId: string) => ['admin-style-gap-events', signalId] as const

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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: styleGapsQueryKey })
      queryClient.invalidateQueries({ queryKey: styleGapStatsQueryKey })
      queryClient.invalidateQueries({ queryKey: styleGapEventsQueryKey(variables.signalId) })
    },
  })
}

export function useStyleGapStats() {
  return useQuery({
    queryKey: styleGapStatsQueryKey,
    queryFn: getStyleGapStats,
  })
}

export function useStyleGapEvents(signalId: string, enabled: boolean) {
  return useQuery({
    queryKey: styleGapEventsQueryKey(signalId),
    queryFn: () => getStyleGapEvents(signalId, 20),
    enabled,
  })
}
