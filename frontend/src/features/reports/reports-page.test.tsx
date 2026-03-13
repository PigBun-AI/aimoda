import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  },
]

vi.mock('@/features/reports/use-reports', () => ({
  useReports: () => ({
    isLoading: false,
    data: reports,
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
    expect(screen.getByText('Brand · AW26')).toBeInTheDocument()
    expect(screen.getByText('已发布')).toBeInTheDocument()
  })
})
