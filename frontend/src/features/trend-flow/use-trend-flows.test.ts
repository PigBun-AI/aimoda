import { describe, expect, it } from 'vitest'

import { trendFlowsQueryKey } from '@/features/trend-flow/use-trend-flows'

describe('trendFlowsQueryKey', () => {
  it('includes the submitted query so trend-flow searches do not share cache entries', () => {
    expect(trendFlowsQueryKey(2, 12, '2025')).toEqual(['trend-flow', 2, 12, '2025'])
  })
})
