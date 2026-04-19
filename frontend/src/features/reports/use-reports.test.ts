import { describe, expect, it } from 'vitest'

import { reportsQueryKey } from '@/features/reports/use-reports'

describe('reportsQueryKey', () => {
  it('includes the submitted query so search results do not share cache entries', () => {
    expect(reportsQueryKey(2, 12, '2026')).toEqual(['reports', 2, 12, '2026'])
  })
})
