// ImageDrawer — 结果面板（仿 aimoda-web ResultPanelContainer）

import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Download, Heart, Maximize2, Minimize2, X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DrawerData, ImageResult } from './chat-types'
import { FashionImage } from './fashion-image'
import { CHAT_THUMBNAIL_MAX_EDGE } from './oss-image'
import { downloadImageAsset } from './image-download'
import { CHAT_PREFERENCE_WEIGHT_OPTIONS, normalizeChatPreferenceWeightValue } from './chat-preferences-bar'
import { FavoriteImageDialog } from '@/features/favorites/favorite-image-dialog'
import { listFavoriteCollections, lookupFavoriteCollections, type FavoriteCollection } from '@/features/favorites/favorites-api'

const DRAWER_HEADER_META_CLASS = 'type-chat-meta text-muted-foreground'
const DRAWER_HEADER_ICON_BUTTON_CLASS =
  'control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground'
const DRAWER_HEADER_ACTION_BUTTON_CLASS =
  'type-chat-action control-pill-sm flex items-center gap-2 border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground'

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
  onTasteProfileChange?: (next: { tasteProfileId: string | null; tasteProfileWeight?: number | null }) => void
  onToggleFullscreen?: () => void
}

export function ImageDrawer({
  open,
  data,
  isFullscreen = false,
  onClose,
  onLoadMore,
  onTasteProfileChange,
  onToggleFullscreen,
}: ImageDrawerProps) {
  const { t } = useTranslation('common')
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [columnCount, setColumnCount] = useState(isFullscreen ? 6 : 4)
  const [collections, setCollections] = useState<FavoriteCollection[]>([])
  const [favoriteTarget, setFavoriteTarget] = useState<ImageResult | null>(null)
  const [favoriteMap, setFavoriteMap] = useState<Record<string, string[]>>({})
  if (!open || !data) return null

  const safeImages = data.images || []
  const displayCount = data.total || safeImages.length
  const thumbnailWidth = isFullscreen ? CHAT_THUMBNAIL_MAX_EDGE.drawerFocus : CHAT_THUMBNAIL_MAX_EDGE.drawer

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

  useEffect(() => {
    if (!open || !data.searchRequestId) return
    listFavoriteCollections()
      .then(result => setCollections(result.filter(collection => collection.can_apply_as_dna ?? collection.can_apply_as_taste)))
      .catch(() => setCollections([]))
  }, [data.searchRequestId, open])

  useEffect(() => {
    setFavoriteMap(prev => {
      const next = { ...prev }
      for (const image of safeImages) {
        if (Array.isArray(image.favorite_collection_ids)) {
          next[image.image_id] = image.favorite_collection_ids
          continue
        }
        if (image.is_favorited === false && !(image.image_id in next)) {
          next[image.image_id] = []
        }
      }
      return next
    })
  }, [safeImages])

  const handleImageClick = (img: typeof safeImages[number]) => {
    window.open(`/image/${img.image_id}`, '_blank')
  }

  const handleImageDownload = (event: MouseEvent<HTMLButtonElement>, img: typeof safeImages[number]) => {
    event.stopPropagation()
    void downloadImageAsset(img.image_url, `${img.image_id}-${img.brand || 'fashion'}.jpg`)
  }

  const handleFavoriteOpen = (event: MouseEvent<HTMLButtonElement>, img: ImageResult) => {
    event.stopPropagation()
    setFavoriteTarget(img)
    if (img.favorite_collection_ids || favoriteMap[img.image_id]) return
    lookupFavoriteCollections(img.image_id)
      .then(result => {
        setFavoriteMap(prev => ({ ...prev, [img.image_id]: result.map(collection => collection.id) }))
      })
      .catch(() => {})
  }

  const handleFavoriteCollectionsChanged = useCallback((collectionIds: string[]) => {
    if (!favoriteTarget) return
    setFavoriteMap(prev => ({ ...prev, [favoriteTarget.image_id]: collectionIds }))
  }, [favoriteTarget])

  return (
    <div className={`flex h-full flex-col animate-in slide-in-from-right duration-normal bg-background ${isFullscreen ? 'border-l-0' : 'border-l border-border'}`}>
      <div className="border-b border-border/80 px-4 py-3 sm:px-5">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="type-chat-label truncate text-foreground/84">
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
                <span className="hidden 2xl:inline">{isFullscreen ? t('exitFocus') : t('focusView')}</span>
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

        {data.searchRequestId && collections.length > 0 && (
          <div className="mt-3 grid gap-3 border-t border-border/80 pt-3 lg:grid-cols-[minmax(0,1fr)_220px_168px] lg:items-center">
            <div className="type-chat-meta text-muted-foreground">
              {t('favoriteDrawerHint')}
            </div>
            <Select
              value={data.tasteProfileId ?? 'none'}
              onValueChange={value =>
                onTasteProfileChange?.({
                  tasteProfileId: value === 'none' ? null : value,
                  tasteProfileWeight: data.tasteProfileWeight ?? 0.24,
                })
              }
            >
              <SelectTrigger className="h-10 rounded-none border-border/80 bg-background type-chat-meta">
                <SelectValue placeholder={t('favoriteDrawerSelect')} />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border/80">
                <SelectItem value="none">{t('favoriteDrawerNone')}</SelectItem>
                {collections.map(collection => (
                  <SelectItem key={collection.id} value={collection.id}>
                    {collection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={normalizeChatPreferenceWeightValue(data.tasteProfileWeight)}
              onValueChange={value =>
                onTasteProfileChange?.({
                  tasteProfileId: data.tasteProfileId ?? null,
                  tasteProfileWeight: Number(value),
                })
              }
              disabled={!data.tasteProfileId}
            >
              <SelectTrigger className="h-10 rounded-none border-border/80 bg-background type-chat-meta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border/80">
                {CHAT_PREFERENCE_WEIGHT_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
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
            <div key={i} className="w-full space-y-2.5">
              <div
                onClick={() => handleImageClick(img)}
                className="group relative w-full cursor-pointer overflow-hidden bg-background"
                style={{ aspectRatio: '1 / 2', width: '100%' }}
                title={t('viewImageItem', { brand: img.brand || t('image') })}
              >
                <FashionImage image={img} className="w-full h-full" thumbnailWidth={thumbnailWidth} />
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/8" />
                <div className="absolute right-2 top-2 flex flex-col gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => handleFavoriteOpen(event, img)}
                    className="flex h-8 w-8 items-center justify-center border border-white/20 bg-background/88 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-foreground"
                    title={t('favorite')}
                    aria-label={t('favorite')}
                  >
                    <Heart
                      size={14}
                      fill={favoriteMap[img.image_id]?.length ? 'currentColor' : 'none'}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => handleImageDownload(event, img)}
                    className="flex h-8 w-8 items-center justify-center border border-white/20 bg-background/88 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-foreground"
                    title={t('download')}
                    aria-label={t('download')}
                  >
                    <Download size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 text-left">
                <div className="flex min-h-[0.875rem] items-center gap-2">
                  {img.year != null && (
                    <div className="type-chat-kicker text-muted-foreground/92">
                      {String(img.year)}
                    </div>
                  )}
                </div>
                {img.brand && (
                  <div className="type-chat-body leading-[1.48] text-foreground/92">
                    {formatBrand(img.brand)}
                  </div>
                )}
                {img.quarter && (
                  <div className="type-chat-meta truncate text-muted-foreground">
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
              className="type-chat-action rounded-none px-8"
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
          <p className="type-chat-kicker mt-8 pb-2 text-center text-muted-foreground">{t('allImagesLoaded')}</p>
        )}
      </div>

      {favoriteTarget && (
        <FavoriteImageDialog
          image={favoriteTarget}
          open={Boolean(favoriteTarget)}
          onOpenChange={openState => {
            if (!openState) {
              setFavoriteTarget(null)
            }
          }}
          onCollectionsChanged={handleFavoriteCollectionsChanged}
        />
      )}
    </div>
  )
}
