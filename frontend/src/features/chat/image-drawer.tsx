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
import { getDeletedImageIdsForSearchRequest, subscribeToCatalogImageDeleted } from '@/features/images/image-lifecycle'
import { AdminImageDeleteButton } from './admin-image-delete-button'

const DRAWER_HEADER_META_CLASS = 'type-chat-meta text-muted-foreground'
const DRAWER_HEADER_ICON_BUTTON_CLASS =
  'control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent/30 hover:text-foreground'
const DRAWER_HEADER_ACTION_BUTTON_CLASS =
  'type-chat-action control-pill-sm flex items-center gap-2 border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent/30 hover:text-foreground'
const DRAWER_IMAGE_ACTION_CLASS =
  'flex size-8 items-center justify-center rounded-none border border-border bg-background text-foreground transition-colors hover:border-foreground'
const DRAWER_CARD_ASPECT_RATIO = '1 / 2'

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

type DrawerDensity = 'narrow' | 'medium' | 'wide'

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
  const drawerRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [columnCount, setColumnCount] = useState(isFullscreen ? 6 : 4)
  const [drawerDensity, setDrawerDensity] = useState<DrawerDensity>(isFullscreen ? 'wide' : 'medium')
  const [collections, setCollections] = useState<FavoriteCollection[]>([])
  const [favoriteTarget, setFavoriteTarget] = useState<ImageResult | null>(null)
  const [favoriteMap, setFavoriteMap] = useState<Record<string, string[]>>({})
  const [deletedImageIds, setDeletedImageIds] = useState<Set<string>>(
    () => new Set(data?.searchRequestId ? getDeletedImageIdsForSearchRequest(data.searchRequestId) : []),
  )
  if (!open || !data) return null

  const deletedCount = (data.images || []).reduce((count, image) => count + (deletedImageIds.has(image.image_id) ? 1 : 0), 0)
  const safeImages = (data.images || []).filter(image => !deletedImageIds.has(image.image_id))
  const displayCount = Math.max(0, (data.total || (data.images || []).length) - deletedCount)
  const thumbnailWidth = isFullscreen ? CHAT_THUMBNAIL_MAX_EDGE.drawerFocus : CHAT_THUMBNAIL_MAX_EDGE.drawer
  const showLoadingState = data.isLoadingMore && safeImages.length === 0
  const showEmptyState = !data.isLoadingMore && safeImages.length === 0

  useEffect(() => {
    const drawerEl = drawerRef.current
    if (!drawerEl) return

    const updateLayout = () => {
      const width = gridRef.current?.clientWidth || drawerEl.clientWidth
      const nextDensity: DrawerDensity = isFullscreen
        ? 'wide'
        : width < 560
          ? 'narrow'
          : width < 880
            ? 'medium'
            : 'wide'
      const minCardWidth = isFullscreen ? 148 : 128
      const gap = isFullscreen ? 14 : 10
      const maxColumns = isFullscreen
        ? 7
        : nextDensity === 'narrow'
          ? 3
          : nextDensity === 'medium'
            ? 4
            : 5
      const minColumns = width < 360 ? 1 : 2
      const next = Math.floor((width + gap) / (minCardWidth + gap))
      setDrawerDensity(nextDensity)
      setColumnCount(Math.max(minColumns, Math.min(maxColumns, next || minColumns)))
    }

    updateLayout()

    const observer = new ResizeObserver(() => {
      updateLayout()
    })
    observer.observe(drawerEl)

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
      let changed = false
      for (const image of safeImages) {
        if (Array.isArray(image.favorite_collection_ids)) {
          const current = prev[image.image_id] ?? []
          const incoming = image.favorite_collection_ids
          const isSameLength = current.length === incoming.length
          const isSameValue = isSameLength && current.every((value, index) => value === incoming[index])
          if (!isSameValue) {
            next[image.image_id] = incoming
            changed = true
          }
          continue
        }
        if (image.is_favorited === false && !(image.image_id in next)) {
          next[image.image_id] = []
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [safeImages])

  useEffect(() => {
    setDeletedImageIds(new Set(data.searchRequestId ? getDeletedImageIdsForSearchRequest(data.searchRequestId) : []))
  }, [data.searchRequestId, data.stepLabel])

  useEffect(() => {
    return subscribeToCatalogImageDeleted((detail) => {
      const imageId = detail.imageId.trim()
      if (!imageId) return

      const currentImages = data.images || []
      const shouldRemove =
        currentImages.some(image => image.image_id === imageId)
        || (data.searchRequestId !== null && detail.affectedSearchRequestIds.includes(data.searchRequestId))

      if (!shouldRemove) return

      setDeletedImageIds(prev => {
        if (prev.has(imageId)) return prev
        const next = new Set(prev)
        next.add(imageId)
        return next
      })
    })
  }, [data.images, data.searchRequestId])

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

  const hasTasteControls = Boolean(data.searchRequestId && collections.length > 0)
  const collectionSelectClassName = cn(
    'h-9 min-h-9 rounded-none border-border/80 bg-background px-2.5 py-2 type-chat-meta',
    drawerDensity === 'narrow'
      ? 'w-full min-w-0'
      : drawerDensity === 'medium'
        ? 'w-[9.5rem]'
        : 'w-[11rem]',
  )
  const weightSelectClassName = cn(
    'h-9 min-h-9 rounded-none border-border/80 bg-background px-2.5 py-2 type-chat-meta',
    drawerDensity === 'narrow'
      ? 'w-full min-w-0'
      : drawerDensity === 'medium'
        ? 'w-[6.5rem]'
        : 'w-[7rem]',
  )

  return (
    <div
      ref={drawerRef}
      className={`flex h-full flex-col animate-in slide-in-from-right duration-normal bg-background ${isFullscreen ? 'border-l-0' : 'border-l border-border'}`}
    >
      <div className="border-b border-border px-3.5 py-2.5 sm:px-4 sm:py-3">
        {drawerDensity === 'narrow' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="type-chat-label truncate text-foreground/84">
                  {t('aiSearchResult')}
                </div>
                <p className={`${DRAWER_HEADER_META_CLASS} shrink-0 whitespace-nowrap`}>
                  {safeImages.length}
                  {displayCount > safeImages.length ? ` / ${displayCount}` : ''} {t('imageUnit')}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {onToggleFullscreen && (
                  <button
                    className={DRAWER_HEADER_ACTION_BUTTON_CLASS}
                    onClick={onToggleFullscreen}
                    aria-label={isFullscreen ? t('exitFocus') : t('focusView')}
                  >
                    {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className={DRAWER_HEADER_ICON_BUTTON_CLASS}
                  aria-label={t('close')}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {hasTasteControls && (
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-1.5">
                <span className="type-chat-kicker col-span-2 text-muted-foreground">
                  {t('favoriteDrawerEyebrow')}
                </span>
                <Select
                  value={data.tasteProfileId ?? 'none'}
                  onValueChange={value =>
                    onTasteProfileChange?.({
                      tasteProfileId: value === 'none' ? null : value,
                      tasteProfileWeight: data.tasteProfileWeight ?? 0.24,
                    })
                  }
                >
                  <SelectTrigger className={collectionSelectClassName}>
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
                  <SelectTrigger className={weightSelectClassName}>
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
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="type-chat-label truncate text-foreground/84">
                {t('aiSearchResult')}
              </div>
              <p className={`${DRAWER_HEADER_META_CLASS} shrink-0 whitespace-nowrap`}>
                {safeImages.length}
                {displayCount > safeImages.length ? ` / ${displayCount}` : ''} {t('imageUnit')}
              </p>
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              {hasTasteControls && (
                <>
                  <span className="type-chat-kicker shrink-0 text-muted-foreground">
                    {t('favoriteDrawerEyebrow')}
                  </span>
                  <Select
                    value={data.tasteProfileId ?? 'none'}
                    onValueChange={value =>
                      onTasteProfileChange?.({
                        tasteProfileId: value === 'none' ? null : value,
                        tasteProfileWeight: data.tasteProfileWeight ?? 0.24,
                      })
                    }
                  >
                    <SelectTrigger className={collectionSelectClassName}>
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
                    <SelectTrigger className={weightSelectClassName}>
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
                </>
              )}
              {onToggleFullscreen && (
                <button
                  className={DRAWER_HEADER_ACTION_BUTTON_CLASS}
                  onClick={onToggleFullscreen}
                  aria-label={isFullscreen ? t('exitFocus') : t('focusView')}
                >
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  <span className="hidden xl:inline">{isFullscreen ? t('exitFocus') : t('focusView')}</span>
                </button>
              )}
              <button
                onClick={onClose}
                className={DRAWER_HEADER_ICON_BUTTON_CLASS}
                aria-label={t('close')}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3 sm:px-4 sm:py-3.5">
        {showLoadingState ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2.5 text-center">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
            <p className="type-chat-meta text-muted-foreground">{t('loading')}</p>
          </div>
        ) : showEmptyState ? (
          <div className="flex h-full min-h-[240px] items-center justify-center">
            <div className="flex max-w-sm flex-col items-center gap-2.5 border border-border px-5 py-6 text-center">
              <p className="type-chat-label text-foreground/88">{t('drawerEmptyTitle')}</p>
              <p className="type-chat-meta leading-relaxed text-muted-foreground">
                {data.emptyState === 'unavailable'
                  ? t('drawerUnavailableHint')
                  : t('drawerEmptyHint')}
              </p>
            </div>
          </div>
        ) : (
          <div
            ref={gridRef}
            className={cn(
              'grid auto-rows-max items-start',
              isFullscreen
                ? 'gap-y-5 gap-x-3.5'
                : 'gap-y-4 gap-x-2.5 xl:gap-x-3',
            )}
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
          >
            {safeImages.map((img) => (
              <div key={img.image_id} className="w-full self-start space-y-2">
                <div
                  onClick={() => handleImageClick(img)}
                  className="group relative w-full cursor-pointer overflow-hidden border border-border bg-background"
                  style={{ aspectRatio: DRAWER_CARD_ASPECT_RATIO, width: '100%' }}
                  title={t('viewImageItem', { brand: img.brand || t('image') })}
                >
                  <FashionImage image={img} className="w-full h-full" thumbnailWidth={thumbnailWidth} />
                  <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/5 dark:group-hover:bg-white/[0.04]" />
                  <div className="absolute right-2 top-2 flex flex-col gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(event) => handleFavoriteOpen(event, img)}
                      className={DRAWER_IMAGE_ACTION_CLASS}
                      title={favoriteMap[img.image_id]?.length ? t('favoriteSaved') : t('favorite')}
                      aria-label={favoriteMap[img.image_id]?.length ? t('favoriteSaved') : t('favorite')}
                    >
                      <Heart
                        size={14}
                        fill={favoriteMap[img.image_id]?.length ? 'currentColor' : 'none'}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => handleImageDownload(event, img)}
                      className={DRAWER_IMAGE_ACTION_CLASS}
                      title={t('download')}
                      aria-label={t('download')}
                    >
                      <Download size={14} />
                    </button>
                    <AdminImageDeleteButton
                      imageId={img.image_id}
                      brand={img.brand}
                      onDeleted={(deletedImageId) => {
                        setDeletedImageIds(prev => {
                          if (prev.has(deletedImageId)) return prev
                          const next = new Set(prev)
                          next.add(deletedImageId)
                          return next
                        })
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1 border-t border-border pt-1.5 text-left">
                  <div className="flex min-h-[0.875rem] items-center gap-1.5">
                    {img.year != null && (
                      <div className="type-chat-kicker text-muted-foreground/92">
                        {String(img.year)}
                      </div>
                    )}
                  </div>
                  {img.brand && (
                    <div className="type-chat-label leading-[1.4] text-foreground/92">
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
        )}

        {data.hasMore && (
          <div className="mb-2 mt-6 flex flex-col items-center justify-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              className="type-chat-action rounded-none px-6"
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
          <p className="type-chat-kicker mt-6 pb-1 text-center text-muted-foreground">{t('allImagesLoaded')}</p>
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
