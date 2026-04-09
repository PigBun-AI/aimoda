import { render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { ImageDrawer } from './image-drawer'

const resizeObserverMock = vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
}))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', resizeObserverMock)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('ImageDrawer', () => {
  it('renders an explicit empty state when a result set contains no images', () => {
    render(
      <ImageDrawer
        open
        data={{
          stepLabel: 'show_collection',
          images: [],
          searchRequestId: null,
          offset: 0,
          hasMore: false,
          total: 0,
          isLoadingMore: false,
          emptyState: 'empty',
        }}
        onClose={() => {}}
        onLoadMore={() => {}}
      />,
    )

    expect(screen.getByText('No images in this result set')).toBeInTheDocument()
  })

  it('renders an unavailable hint when the ref result cannot be loaded', () => {
    render(
      <ImageDrawer
        open
        data={{
          stepLabel: 'show_collection',
          images: [],
          searchRequestId: null,
          offset: 0,
          hasMore: false,
          total: 0,
          isLoadingMore: false,
          emptyState: 'unavailable',
        }}
        onClose={() => {}}
        onLoadMore={() => {}}
      />,
    )

    expect(screen.getByText('This result entry is currently unavailable. The underlying search result may be stale or was not persisted successfully.')).toBeInTheDocument()
  })
})
