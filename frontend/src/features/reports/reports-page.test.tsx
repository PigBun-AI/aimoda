import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { ReportsPage } from '@/features/reports/reports-page'

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

vi.mock('@/features/reports/use-reports', () => ({
  useReports: () => ({
    isLoading: false,
    data: {
      reports,
      total: 1,
      page: 1,
      limit: 12,
      totalPages: 1,
    },
  }),
}))

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders report cards from query data', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
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
})
