import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { ReportDetailPage } from '@/features/reports/report-detail-page'

vi.mock('@/features/reports/use-report-detail', () => ({
  useReportDetail: () => ({
    isLoading: false,
    data: {
      id: 'report-1',
      slug: 'unsafe-report',
      title: '非法链接报告',
      brand: 'Brand',
      season: 'AW26',
      status: 'published',
      updatedAt: '2026-03-12T10:00:00.000Z',
      description: '测试 iframe 安全限制',
      iframeUrl: 'https://evil.example.com/report',
      tags: ['unsafe'],
    },
  }),
}))

vi.mock('@/features/reports/use-reports', () => ({
  useReports: () => ({
    isLoading: false,
    data: {
      reports: [],
      total: 0,
      page: 1,
      limit: 12,
      totalPages: 1,
    },
  }),
}))

describe('ReportDetailPage', () => {
  it('blocks unsafe iframe urls', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reports/report-1']}>
          <Routes>
            <Route path="/reports/:reportId" element={<ReportDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('This article URL does not meet security loading policy')).toBeInTheDocument()
    expect(screen.queryByTitle('非法链接报告')).not.toBeInTheDocument()
  })
})
