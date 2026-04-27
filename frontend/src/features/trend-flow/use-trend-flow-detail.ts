import { useQuery } from "@tanstack/react-query";

import { getTrendFlowById } from "@/lib/api";

export const trendFlowDetailQueryKey = (trendFlowId: string) =>
  ["trend-flow-detail", trendFlowId] as const;

export function useTrendFlowDetail(trendFlowId: string) {
  return useQuery({
    queryKey: trendFlowDetailQueryKey(trendFlowId),
    queryFn: () => getTrendFlowById(trendFlowId),
    enabled: trendFlowId.length > 0,
  });
}
