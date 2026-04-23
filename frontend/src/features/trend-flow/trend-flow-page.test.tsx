import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROUTER_FUTURE } from '@/app/router-future'
import '@/i18n'
import { TrendFlowPage } from '@/features/trend-flow/trend-flow-page'
import { useTrendFlows } from '@/features/trend-flow/use-trend-flows'
import { ApiError } from '@/lib/api'

const trendFlows = [
  {
    id: 'trend-1',
    slug: 'miumiu-2025-trend-flow',
    title: 'Miu Miu 趋势流动：2025',
    brand: 'Miu Miu',
    windowLabel: '2025 早春 → 2025 秋冬',
    timeline: [
      { quarter: '早春', year: 2025 },
      { quarter: '春夏', year: 2025 },
      { quarter: '早秋', year: 2025 },
      { quarter: '秋冬', year: 2025 },
    ],
    status: 'published' as const,
    updatedAt: '2026-04-23T10:00:00.000Z',
    coverImageUrl: 'https://example.com/cover.jpg',
    previewUrl: '/api/trend-flow/1/preview/pages/report.html',
    leadExcerpt: '连续四季的品牌演化。',
  },
]

const mockedUseTrendFlows = vi.fn()

vi.mock('@/features/trend-flow/use-trend-flows', () => ({
  useTrendFlows: (...args: Parameters<typeof useTrendFlows>) => mockedUseTrendFlows(...args),
}))

describe('TrendFlowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUseTrendFlows.mockImplementation((_page = 1, _limit = 12, q = '') => ({
      isLoading: false,
      data: {
        items: q === '2024' ? [] : trendFlows,
        total: q === '2024' ? 0 : 1,
        page: 1,
        limit: 12,
        totalPages: 1,
      },
    }))
  })

  it('renders trend-flow cards from query data', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <TrendFlowPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Miu Miu 趋势流动：2025')).toBeInTheDocument()
    expect(screen.getByText('连续四季的品牌演化。')).toBeInTheDocument()
    const openLinks = screen.getAllByRole('link', { name: /Miu Miu 趋势流动：2025/i })
    expect(openLinks[0]).toHaveAttribute('href', '/trend-flow/trend-1')
  })

  it('submits keyword search and shows dedicated empty state for no matches', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <TrendFlowPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.type(screen.getByPlaceholderText('Search brand, title, quarter, or year'), '2024')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(mockedUseTrendFlows).toHaveBeenLastCalledWith(1, 12, '2024')
    expect(screen.getByText('No matching trend flows')).toBeInTheDocument()
  })

  it('shows membership lock state for 403 responses', () => {
    const queryClient = new QueryClient()
    mockedUseTrendFlows.mockReturnValue({
      isLoading: false,
      data: undefined,
      error: new ApiError('subscription required', 403),
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <TrendFlowPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Full trend-flow archives require membership access')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open membership' })).toHaveAttribute('href', '/profile?tab=access')
  })
})
