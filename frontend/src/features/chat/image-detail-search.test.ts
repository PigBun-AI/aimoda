import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { searchSimilar } from './chat-api'
import { getImageDetailGridColumns, getImageDetailSearchPageSize, useImageDetailSearch } from './image-detail-search'

vi.mock('./chat-api', () => ({
  searchSimilar: vi.fn(),
  searchByColor: vi.fn(),
}))

const mockedSearchSimilar = vi.mocked(searchSimilar)

describe('image detail search layout helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('scrollTo', vi.fn())
  })

  it('matches the responsive grid column breakpoints', () => {
    expect(getImageDetailGridColumns(390)).toBe(2)
    expect(getImageDetailGridColumns(900)).toBe(3)
    expect(getImageDetailGridColumns(1366)).toBe(4)
    expect(getImageDetailGridColumns(1600)).toBe(5)
  })

  it('always returns a page size that fills complete rows', () => {
    expect(getImageDetailSearchPageSize(390)).toBe(6)
    expect(getImageDetailSearchPageSize(900)).toBe(9)
    expect(getImageDetailSearchPageSize(1366)).toBe(12)
    expect(getImageDetailSearchPageSize(1600)).toBe(15)
  })

  it('reuses the responsive page size when paginating brand results', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1366,
    })

    const scrollTarget = document.createElement('div')
    document.body.appendChild(scrollTarget)

    mockedSearchSimilar
      .mockResolvedValueOnce({ images: [], total: 24, page: 1, page_size: 12, has_more: true })
      .mockResolvedValueOnce({ images: [], total: 24, page: 2, page_size: 12, has_more: false })

    const { result } = renderHook(() => useImageDetailSearch({ current: scrollTarget }))

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    await act(async () => {
      await result.current.searchByBrand('balenciaga', 'Balenciaga')
    })

    await act(async () => {
      await result.current.changePage(2)
    })

    await waitFor(() => {
      expect(mockedSearchSimilar).toHaveBeenNthCalledWith(1, {
        brand: 'balenciaga',
        page: 1,
        page_size: 12,
      })
      expect(mockedSearchSimilar).toHaveBeenNthCalledWith(2, {
        brand: 'balenciaga',
        page: 2,
        page_size: 12,
      })
    })
  })
})
