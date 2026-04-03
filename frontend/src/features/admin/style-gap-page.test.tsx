import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { StyleGapPage } from '@/features/admin/style-gap-page'

const mutate = vi.fn()

vi.mock('@/features/admin/use-style-gaps', () => ({
  useStyleGaps: () => ({
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    data: {
      total: 1,
      items: [
        {
          id: 'gap-1',
          queryRaw: '巴恩风',
          queryNormalized: 'barn style',
          source: 'agent_auto',
          triggerTool: 'search_style',
          searchStage: 'not_found',
          status: 'open',
          totalHits: 3,
          uniqueSessions: 2,
          linkedStyleName: null,
          resolutionNote: '',
          resolvedBy: '',
          firstSeenAt: '2026-04-03T10:00:00Z',
          lastSeenAt: '2026-04-03T12:00:00Z',
          coveredAt: null,
          latestContext: { fallback_suggestion: 'barn english label' },
        },
      ],
    },
  }),
  useUpdateStyleGap: () => ({
    isPending: false,
    variables: undefined,
    mutate,
  }),
}))

describe('StyleGapPage', () => {
  it('renders style gap rows from query data', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <StyleGapPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('巴恩风')).toBeInTheDocument()
  })
})
