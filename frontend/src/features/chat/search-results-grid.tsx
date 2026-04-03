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

  const { images, total, page, page_size, has_more } = searchResults
  const totalPages = Math.ceil(total / page_size)

  const handleImageClick = useCallback(
    (image: ImageResult) => {
      // Always open in a new tab to avoid stacking navigation
      window.open(`/image/${image.image_id}`, '_blank', 'noopener')
    },
    [],
  )

  if (images.length === 0 && !isLoading) {
    return (
      <div className="w-full max-w-[1784px] mt-6 mb-6 text-center py-12">
        <p className="text-muted-foreground">{t('noRelatedImages')}</p>
      </div>
    )
  }

  return (
    <div ref={gridRef} className="w-full max-w-[1784px] mt-6 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">
          {labelName}
          <span className="text-sm text-muted-foreground font-normal ml-2">
            {t('imageCountSummary', { count: total })}
          </span>
        </h3>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || isLoading}
              className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-muted-foreground min-w-[60px] text-center">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={!has_more || isLoading}
              className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">{t('searching')}</span>
        </div>
      )}

      {/* Image Grid */}
      {!isLoading && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {images.map((image) => (
            <div
              key={image.image_id}
              className="relative group cursor-pointer overflow-hidden bg-muted"
              style={{ aspectRatio: '1 / 2' }}
              onClick={() => handleImageClick(image)}
            >
              <FashionImage image={image} className="w-full h-full" />
              {/* Hover overlay with brand info */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
              {(image.brand || image.year) && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="text-white text-xs space-y-0.5">
                    {image.brand && (
                      <div className="font-semibold truncate">{image.brand}</div>
                    )}
                    {image.year && (
                      <div className="text-white/80">{image.year}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bottom pagination */}
      {totalPages > 1 && !isLoading && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="h-8 px-3 flex items-center gap-1 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft size={14} />
            {t('previous')}
          </button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={!has_more}
            className="h-8 px-3 flex items-center gap-1 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            {t('next')}
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
