// ImageDrawer — 结果面板（仿 aimoda-web ResultPanelContainer）

import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { DrawerData } from './chat-types'
import { FashionImage } from './fashion-image'

const DRAWER_HEADER_META_CLASS = 'type-ui-label-sm text-muted-foreground'
const DRAWER_HEADER_ICON_BUTTON_CLASS =
  'control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground'
const DRAWER_HEADER_ACTION_BUTTON_CLASS =
  'type-action-label control-pill-sm flex items-center gap-2 border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground'

/** Format brand name: capitalize each word */
function formatBrand(brand: string): string {
  if (!brand) return ''
  return brand
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

interface ImageDrawerProps {
  open: boolean
  data: DrawerData | null
  isFullscreen?: boolean
  onClose: () => void
  onLoadMore: () => void
  onToggleFullscreen?: () => void
}

export function ImageDrawer({
  open,
  data,
  isFullscreen = false,
  onClose,
  onLoadMore,
  onToggleFullscreen,
}: ImageDrawerProps) {
  const { t } = useTranslation('common')
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [columnCount, setColumnCount] = useState(isFullscreen ? 6 : 4)
  if (!open || !data) return null

  const safeImages = data.images || []
  const displayCount = data.total || safeImages.length
  const thumbnailWidth = isFullscreen ? 1120 : 760

  useEffect(() => {
    const gridEl = gridRef.current
    if (!gridEl) return

    const updateColumns = () => {
      const width = gridEl.clientWidth
      const minCardWidth = isFullscreen ? 150 : 132
      const gap = isFullscreen ? 16 : 12
      const maxColumns = isFullscreen ? 7 : 5
      const minColumns = width < 320 ? 1 : 2
      const next = Math.floor((width + gap) / (minCardWidth + gap))
      setColumnCount(Math.max(minColumns, Math.min(maxColumns, next || minColumns)))
    }

    updateColumns()

    const observer = new ResizeObserver(() => {
      updateColumns()
    })
    observer.observe(gridEl)

    return () => observer.disconnect()
  }, [isFullscreen])

  const handleImageClick = (img: typeof safeImages[number]) => {
    window.open(`/image/${img.image_id}`, '_blank')
  }

  return (
    <div className={`flex h-full flex-col animate-in slide-in-from-right duration-normal bg-background ${isFullscreen ? 'border-l-0' : 'border-l border-border'}`}>
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="type-ui-title-md truncate text-foreground">
              {t('aiSearchResult')}
            </div>
            <p className={`${DRAWER_HEADER_META_CLASS} shrink-0 whitespace-nowrap`}>
              {safeImages.length}
              {displayCount > safeImages.length ? ` / ${displayCount}` : ''} {t('imageUnit')}
            </p>
          </div>

          <div className="flex items-center gap-1">
            {onToggleFullscreen && (
              <button
                className={DRAWER_HEADER_ACTION_BUTTON_CLASS}
                onClick={onToggleFullscreen}
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                <span className="hidden xl:inline">{isFullscreen ? t('exitFocus') : t('focusView')}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className={DRAWER_HEADER_ICON_BUTTON_CLASS}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        <div
          ref={gridRef}
          className={cn(
            'grid',
            isFullscreen
              ? 'gap-y-7 gap-x-4'
              : 'gap-y-6 gap-x-3 xl:gap-x-4',
          )}
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          {safeImages.map((img, i) => (
            <div key={i} className="w-full space-y-2">
              <div
                onClick={() => handleImageClick(img)}
                className="group relative w-full cursor-pointer overflow-hidden border border-border bg-muted transition-colors hover:border-foreground"
                style={{ aspectRatio: '1 / 2', width: '100%' }}
                title={t('viewImageItem', { brand: img.brand || t('image') })}
              >
                <FashionImage image={img} className="w-full h-full" thumbnailWidth={thumbnailWidth} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </div>

              <div className="space-y-0.5 text-left">
                {img.year != null && (
                  <div className="type-kicker text-muted-foreground">
                    {String(img.year)}
                  </div>
                )}
                {img.brand && (
                  <div className="type-ui-body-sm text-foreground">
                    {formatBrand(img.brand)}
                  </div>
                )}
                {img.quarter && (
                  <div className="type-ui-meta truncate text-muted-foreground">
                    {img.quarter}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {data.hasMore && (
          <div className="mt-8 mb-4 flex flex-col items-center justify-center gap-3">
            <Button
              variant="outline"
              className="px-8"
              onClick={onLoadMore}
              disabled={data.isLoadingMore}
            >
              {data.isLoadingMore ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  {t('loading')}
                </>
              ) : (
                t('loadMore')
              )}
            </Button>
          </div>
        )}

        {!data.hasMore && safeImages.length > 0 && (
          <p className="type-kicker mt-8 pb-2 text-center text-muted-foreground">{t('allImagesLoaded')}</p>
        )}
      </div>
    </div>
  )
}
