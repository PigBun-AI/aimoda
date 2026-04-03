import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getImageListContext } from './image-context'
import { ImageInfoPanel } from './image-info-panel'
import { ImageViewer } from './image-viewer'
import { ImageActionBar } from './image-action-bar'
import { SearchResultsGrid } from './search-results-grid'
import { searchSimilar, searchByColor, fetchImageDetail } from './chat-api'
import type { SearchResponse } from './chat-api'
import type { ImageResult } from './chat-types'

export function ImageDetailPage() {
  const { t } = useTranslation('common')
  const { imageId } = useParams<{ imageId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const contextId = searchParams.get('contextId')
  const searchResultsRef = useRef<HTMLDivElement>(null)

  // Image data state — loaded from context OR fetched from API
  const [fetchedImage, setFetchedImage] = useState<ImageResult | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  // Search results state
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null)
  const [searchLabel, setSearchLabel] = useState('')
  const [isSearchLoading, setIsSearchLoading] = useState(false)
  const lastSearchRef = useRef<{ type: string; params: any } | null>(null)

  // Try to get from context first (legacy multi-image mode)
  const context = useMemo(() => {
    if (!contextId) return null
    return getImageListContext(contextId)
  }, [contextId])

  const images = context?.images ?? []

  const currentIndex = useMemo(() => {
    if (!imageId) return -1
    return images.findIndex((img) => img.image_id === imageId)
  }, [images, imageId])

  // Fetch from API if no context is available
  useEffect(() => {
    if (context || !imageId) return
    setIsFetching(true)
    fetchImageDetail(imageId)
      .then((data) => setFetchedImage(data))
      .catch((err) => console.error('Failed to fetch image detail:', err))
      .finally(() => setIsFetching(false))
  }, [imageId, context])

  // Determine current image: context-based or API-fetched
  const currentImage = currentIndex >= 0 ? images[currentIndex] : fetchedImage
  const hasMultiple = images.length > 1

  const goPrev = () => {
    if (currentIndex > 0) {
      const prev = images[currentIndex - 1]
      navigate(`/image/${prev.image_id}${contextId ? `?contextId=${contextId}` : ''}`, {
        replace: true,
      })
      setSearchResults(null)
      lastSearchRef.current = null
    }
  }

  const goNext = () => {
    if (currentIndex < images.length - 1) {
      const next = images[currentIndex + 1]
      navigate(`/image/${next.image_id}${contextId ? `?contextId=${contextId}` : ''}`, {
        replace: true,
      })
      setSearchResults(null)
      lastSearchRef.current = null
    }
  }

  const handleClose = () => {
    window.close()
  }

  /** Callback from ImageLabels, ImageInfoPanel, ImageViewer */
  const handleSearchResult = useCallback((
    results: SearchResponse,
    labelName: string,
    searchType?: string,
    params?: any,
  ) => {
    setSearchResults(results)
    setSearchLabel(labelName)
    if (searchType && params) {
      lastSearchRef.current = { type: searchType, params }
    }
    setTimeout(() => {
      searchResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [])

  /** Handle pagination */
  const handlePageChange = useCallback(async (page: number) => {
    const params = lastSearchRef.current
    if (!params) return
    setIsSearchLoading(true)
    try {
      let results: SearchResponse
      if (params.type === 'color') {
        results = await searchByColor({ ...params.params, page })
      } else {
        results = await searchSimilar({ ...params.params, page })
      }
      setSearchResults(results)
    } catch (err) {
      console.error('Pagination failed:', err)
    } finally {
      setIsSearchLoading(false)
    }
  }, [])

  const isLoading = !currentImage && (isFetching || context !== null)

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Left: logo + navigation */}
          <div className="flex items-center gap-3">
            <img src="/aimoda-logo.svg" alt="aimoda" className="dark:hidden h-5 w-auto" />
            <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden dark:block h-5 w-auto" />
            {hasMultiple && currentIndex > 0 && (
              <button
                onClick={goPrev}
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                aria-label={t('previousImage')}
              >
                <ChevronLeft size={18} className="text-foreground/70" />
              </button>
            )}
            {hasMultiple && (
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                {currentIndex + 1} / {images.length}
              </span>
            )}
            {hasMultiple && currentIndex < images.length - 1 && (
              <button
                onClick={goNext}
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                aria-label={t('nextImage')}
              >
                <ChevronRight size={18} className="text-foreground/70" />
              </button>
            )}
          </div>
          {/* Right: close */}
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
            aria-label={t('close')}
          >
            <X size={18} className="text-foreground/70" />
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      {isLoading && (
        <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 56px)' }}>
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
            </div>
            <p className="text-sm text-muted-foreground">{t('loadingImageDetails')}</p>
          </div>
        </div>
      )}

      {currentImage && (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
          {/* Three-column layout: Info | Image | Actions */}
          <div className="flex flex-col lg:flex-row" style={{ maxHeight: 'calc(100vh - 56px)' }}>
            {/* Left: Info panel — collapses to top on mobile */}
            <div className="order-2 lg:order-1 shrink-0">
              <ImageInfoPanel
                image={currentImage}
                onSearchResult={handleSearchResult}
              />
            </div>

            {/* Center: Image viewer — takes remaining space */}
            <div className="order-1 lg:order-2 flex-1 relative flex items-center justify-center min-h-[50vh] lg:min-h-0 overflow-hidden">
              <ImageViewer
                image={currentImage}
                onSearchResult={handleSearchResult}
              />
            </div>

            {/* Right: Action bar — collapses to bottom on mobile */}
            <div className="order-3 shrink-0">
              <ImageActionBar image={currentImage} />
            </div>
          </div>

          {/* Search results — below the main content */}
          {searchResults && searchResults.images.length > 0 && (
            <div ref={searchResultsRef} className="pb-8" style={{ scrollMarginTop: '72px' }}>
              <SearchResultsGrid
                searchResults={searchResults}
                labelName={searchLabel}
                onPageChange={handlePageChange}
                isLoading={isSearchLoading}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
