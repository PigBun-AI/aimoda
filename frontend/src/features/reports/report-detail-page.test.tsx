import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ReportDetailPage } from '@/features/reports/report-detail-page'

vi.mock('@/features/reports/use-report-detail', () => ({
  useReportDetail: () => ({
    isLoading: false,
    data: {
      id: 'report-1',
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

    expect(screen.getByText('该报告地址不符合安全加载策略。')).toBeInTheDocument()
    expect(screen.queryByTitle('非法链接报告')).not.toBeInTheDocument()
  })
})
