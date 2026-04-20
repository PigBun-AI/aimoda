import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ROUTER_FUTURE } from '@/app/router-future'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { ReportsPage } from '@/features/reports/reports-page'
import { useReports } from '@/features/reports/use-reports'

const reports = [
  {
    id: 'report-1',
    slug: 'test-brand-fall-2026',
    title: '测试报告',
    brand: 'Brand',
    season: 'AW26',
    status: 'published' as const,
    updatedAt: '2026-03-12T10:00:00.000Z',
    coverImageUrl: '/reports/test-brand-fall-2026/cover.jpg',
    previewUrl: '/api/reports/1/preview/index.html',
    leadExcerpt: '报告首页的导语文案会直接出现在卡片简介区域。',
  },
]

const mockedUseReports = vi.fn()

vi.mock('@/features/reports/use-reports', () => ({
  useReports: (...args: Parameters<typeof useReports>) => mockedUseReports(...args),
}))

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUseReports.mockImplementation((_page = 1, _limit = 12, q = '') => ({
      isLoading: false,
      data: {
        reports: q === '2024' ? [] : reports,
        total: q === '2024' ? 0 : 1,
        page: 1,
        limit: 12,
        totalPages: 1,
      },
    }))
  })

  it('renders report cards from query data', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <ReportsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('测试报告')).toBeInTheDocument()
    expect(screen.getByText('报告首页的导语文案会直接出现在卡片简介区域。')).toBeInTheDocument()
    expect(screen.queryByText('Archive issue')).not.toBeInTheDocument()
    expect(screen.queryByText('#01')).not.toBeInTheDocument()
    expect(screen.getByText('Open report')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /测试报告/i })).toHaveAttribute('href', '/api/reports/1/preview/index.html')
  })

  it('submits keyword search and shows dedicated empty state for no matches', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <ReportsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.type(screen.getByPlaceholderText('Search title, brand, season, or year'), '2024')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(mockedUseReports).toHaveBeenLastCalledWith(1, 12, '2024')
    expect(screen.getByText('No matching reports')).toBeInTheDocument()
    expect(screen.getByText('No fashion week reports matched “2024”. Try another brand, season, or year.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })
})
