import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getReportById, getReports, getTrendFlows } from '@/lib/api'

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

  it('includes q when requesting paginated trend flows search results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 12, totalPages: 0 },
      }),
    })

    vi.stubGlobal('fetch', fetchMock)

    await getTrendFlows(1, 12, '2025')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/trend-flow?page=1&limit=12&q=2025',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })

  it('includes q when requesting paginated reports search results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 12, totalPages: 0 },
      }),
    })

    vi.stubGlobal('fetch', fetchMock)

    await getReports(1, 12, '2026')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports?page=1&limit=12&q=2026',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })
})
