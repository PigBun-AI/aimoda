import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { SearchResultCard } from './search-result-card'

vi.mock('./chat-api', () => ({
  DEFAULT_DRAWER_PAGE_SIZE: 50,
  deleteCatalogImage: vi.fn(),
  fetchCachedSearchSessionById: vi.fn(),
  peekCachedSearchSessionById: vi.fn(() => null),
}))

vi.mock('@/features/images/image-lifecycle', () => ({
  getDeletedImageIdsForSearchRequest: vi.fn(() => []),
  subscribeToCatalogImageDeleted: vi.fn(() => () => {}),
}))

vi.mock('./fashion-image', () => ({
  FashionImage: ({ image }: { image: { image_url: string; brand?: string } }) => (
    <img alt={image.brand || 'preview'} src={image.image_url} />
  ),
}))

import { fetchCachedSearchSessionById, peekCachedSearchSessionById } from './chat-api'

const mockedFetchCachedSearchSessionById = vi.mocked(fetchCachedSearchSessionById)
const mockedPeekCachedSearchSessionById = vi.mocked(peekCachedSearchSessionById)

describe('SearchResultCard', () => {
  it('hydrates preview images from the current retrieval preferences', async () => {
    mockedPeekCachedSearchSessionById.mockReturnValueOnce(null)
    mockedFetchCachedSearchSessionById.mockResolvedValue({
      images: [
        {
          image_url: 'https://example.com/look-1.jpg',
          image_id: 'look-1',
          brand: 'Akris',
          score: 0.91,
          garments: [],
          extracted_colors: [],
          colors: [],
          style: '',
        },
      ],
      total: 12,
      offset: 0,
      limit: 50,
      has_more: false,
    })

    render(
      <SearchResultCard
        data={{
          action: 'show_collection',
          total: 12,
          filters_applied: [],
          message: 'Showing 12 matching images.',
          search_request_id: 'artifact-1',
        }}
        retrievalPreferences={{
          taste_profile_id: 'dna-1',
          taste_profile_weight: 0.4,
        }}
        onOpenDrawer={() => {}}
      />,
    )

    await waitFor(() => {
      expect(mockedFetchCachedSearchSessionById).toHaveBeenCalledWith('artifact-1', 0, 50, 'dna-1', 0.4)
    })

    expect(await screen.findByAltText('Akris')).toBeInTheDocument()
  })
})
