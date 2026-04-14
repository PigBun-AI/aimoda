import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getReportById, getReports } from '@/lib/api'

describe('api client fallback policy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('throws on 401 responses instead of falling back to mock data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn(),
      }),
    )

    await expect(getReports()).rejects.toThrow('401')
  })

  it('throws on 403 responses instead of falling back to mock data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: vi.fn(),
      }),
    )

    await expect(getReportById('report-1')).rejects.toThrow('403')
  })
})
