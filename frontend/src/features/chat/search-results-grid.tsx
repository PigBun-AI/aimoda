import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { isCatalogImageDeleted, useCatalogImageLifecycleVersion } from '@/features/images/image-lifecycle'
import type { ImageResult } from './chat-types'
import type { SearchResponse } from './chat-api'
import { FashionImage } from './fashion-image'

interface SearchResultsGridProps {
  searchResults: SearchResponse
  labelName: string
  onPageChange: (page: number) => void
  isLoading: boolean
}

function formatBrand(brand: string): string {
  if (!brand) return ''
  return brand
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function SearchResultsGrid({
  searchResults,
  labelName,
  onPageChange,
  isLoading,
}: SearchResultsGridProps) {
  const { t } = useTranslation('common')
  const gridRef = useRef<HTMLDivElement>(null)
  const [columnCount, setColumnCount] = useState(4)
  const lifecycleVersion = useCatalogImageLifecycleVersion()

  const { images, total, page, page_size } = searchResults
  const visibleImages = useMemo(
    () => images.filter(image => !isCatalogImageDeleted(image.image_id)),
    [images, lifecycleVersion],
  )
  const visibleTotal = Math.max(0, total - (images.length - visibleImages.length))
  const totalPages = Math.max(1, Math.ceil(visibleTotal / page_size))

  useEffect(() => {
    const gridEl = gridRef.current
    if (!gridEl) return

    const updateColumns = () => {
      const width = gridEl.clientWidth
      const minCardWidth = 150
      const gap = 16
      const maxColumns = 7
      const minColumns = width < 360 ? 2 : 3
      const next = Math.floor((width + gap) / (minCardWidth + gap))
      setColumnCount(Math.max(minColumns, Math.min(maxColumns, next || minColumns)))
    }

    updateColumns()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(updateColumns)
    observer.observe(gridEl)
    return () => observer.disconnect()
  }, [])

  const handleImageClick = useCallback((image: ImageResult) => {
    window.open(`/image/${image.image_id}`, '_blank', 'noopener')
  }, [])

  if (visibleImages.length === 0 && !isLoading) {
    return (
      <section className="border-t border-border/80 pt-6">
        <div className="flex min-h-[280px] items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-3 border border-border/80 px-6 py-7 text-center">
            <p className="type-chat-label text-foreground/88">{t('noRelatedImages')}</p>
            <p className="type-chat-meta leading-relaxed text-muted-foreground">{t('drawerEmptyHint')}</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="border-t border-border/80 pt-6">
      <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="type-chat-title max-w-[42ch] text-balance text-foreground/92 sm:max-w-[52ch]">
            {labelName}
          </h3>
          <p className="type-chat-meta whitespace-nowrap text-muted-foreground">
            {visibleTotal} {t('imageUnit')}
          </p>
        </div>

        {totalPages > 1 && (
          <div className="flex shrink-0 items-center gap-1 self-start sm:mt-0.5">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || isLoading}
              className="control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="type-chat-meta min-w-[76px] text-center text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
              className="control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
          <p className="type-chat-meta text-muted-foreground">{t('searching')}</p>
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid gap-y-7 gap-x-4"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          {visibleImages.map(image => (
            <div key={image.image_id} className="w-full space-y-2.5">
              <div
                className="group relative w-full cursor-pointer overflow-hidden bg-background"
                style={{ aspectRatio: '1 / 2' }}
                onClick={() => handleImageClick(image)}
              >
                <FashionImage image={image} className="h-full w-full" thumbnailWidth={1280} />
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/8" />
              </div>

              <div className="space-y-1.5 text-left">
                <div className="flex min-h-[0.875rem] items-center gap-2">
                  {image.year != null && (
                    <div className="type-chat-kicker text-muted-foreground/92">
                      {String(image.year)}
                    </div>
                  )}
                </div>
                {image.brand && (
                  <div className="type-chat-body leading-[1.48] text-foreground/92">
                    {formatBrand(image.brand)}
                  </div>
                )}
                {image.quarter && (
                  <div className="type-chat-meta truncate text-muted-foreground">
                    {image.quarter}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
