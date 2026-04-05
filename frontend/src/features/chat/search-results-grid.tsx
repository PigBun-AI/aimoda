import { useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ImageResult } from './chat-types'
import type { SearchResponse } from './chat-api'
import { FashionImage } from './fashion-image'

interface SearchResultsGridProps {
  searchResults: SearchResponse
  labelName: string
  onPageChange: (page: number) => void
  isLoading: boolean
}

export function SearchResultsGrid({
  searchResults,
  labelName,
  onPageChange,
  isLoading,
}: SearchResultsGridProps) {
  const { t } = useTranslation('common')
  const gridRef = useRef<HTMLDivElement>(null)

  const { images, total, page, page_size } = searchResults
  const totalPages = Math.ceil(total / page_size)

  const handleImageClick = useCallback((image: ImageResult) => {
    window.open(`/image/${image.image_id}`, '_blank', 'noopener')
  }, [])

  if (images.length === 0 && !isLoading) {
    return (
      <div className="mb-6 mt-6 w-full border border-border px-4 py-12 text-center sm:px-6">
        <p className="type-ui-label-sm text-muted-foreground">{t('noRelatedImages')}</p>
      </div>
    )
  }

  return (
    <div ref={gridRef} className="mb-6 mt-6 w-full border border-border">
      <div className="grid gap-4 border-b border-border px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="type-ui-title-lg truncate text-foreground">
            {labelName}
          </h3>
          <p className="type-kicker text-muted-foreground">
            {t('imageCountSummary', { count: total })}
          </p>
        </div>

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || isLoading}
              className="control-icon-sm flex items-center justify-center border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="type-kicker min-w-[72px] text-center text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
              className="control-icon-sm flex items-center justify-center border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 px-4 py-16 sm:px-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="type-kicker text-muted-foreground">{t('searching')}</span>
        </div>
      )}

      {!isLoading && (
        <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {images.map(image => (
            <div
              key={image.image_id}
              className="group relative cursor-pointer overflow-hidden bg-background"
              style={{ aspectRatio: '1 / 2' }}
              onClick={() => handleImageClick(image)}
            >
              <FashionImage image={image} className="h-full w-full" thumbnailWidth={1280} />
              <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
              {(image.brand || image.year) && (
                <div className="absolute inset-x-0 bottom-0 border-t border-white/15 bg-gradient-to-t from-black/72 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="space-y-1 text-white">
                    {image.brand && (
                      <div className="type-kicker truncate">
                        {image.brand}
                      </div>
                    )}
                    {image.year && (
                      <div className="type-meta text-white/75">{image.year}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && !isLoading && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border px-4 py-4 sm:px-6">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="type-action-label control-pill-sm flex items-center gap-1 border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft size={14} />
            {t('previous')}
          </button>
          <span className="type-kicker min-w-[72px] text-center text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="type-action-label control-pill-sm flex items-center gap-1 border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            {t('next')}
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
