// SearchResultCard — show_collection tool result rendered as a rich card
// Preview images are hydrated from the same paginated search source as the drawer,
// so the inline preview and the expanded result set always stay in sync.

import { useEffect, useMemo, useState } from 'react'
import { Filter, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_DRAWER_PAGE_SIZE, fetchCachedSearchSessionById, peekCachedSearchSessionById } from './chat-api'
import type { SearchResultData, ImageResult, ChatSessionPreferences } from './chat-types'
import { FashionImage } from './fashion-image'
import { CHAT_THUMBNAIL_MAX_EDGE } from './oss-image'

interface SearchResultCardProps {
  data: SearchResultData
  onOpenDrawer: (searchRequestId: string) => void
  retrievalPreferences?: ChatSessionPreferences | null
}

function normalizeQuarterLabel(value: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const normalized = value.trim().toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ')
  if (['早春', 'resort', 'cruise', 'pre spring', 'q1'].includes(normalized)) return t('chatPreferenceQuarterResort')
  if (['ss', 'spring summer', 'spring', 'summer'].includes(normalized)) return t('seasonSpringSummer')
  if (['早秋', 'pre fall', 'prefall', 'pf', 'q3'].includes(normalized)) return t('chatPreferenceQuarterPreFall')
  if (['fw', 'fall winter', 'autumn winter', 'fall', 'winter'].includes(normalized)) return t('seasonFallWinter')
  if (['q2'].includes(normalized)) return t('seasonSpringSummer')
  if (['q4'].includes(normalized)) return t('seasonFallWinter')
  return value
}

/** Format filter tag for display: "category=dress" → "dress" */
function formatFilterTag(filter: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const parts = filter.split('=')
  if (parts.length === 2) {
    let [dim, val] = parts
    if (dim === 'season') {
      dim = 'quarter'
      val = normalizeQuarterLabel(val, t)
    } else if (dim === 'quarter') {
      val = normalizeQuarterLabel(val, t)
    }
    // Show dimension:value for garment tags, just value for simple ones
    if (dim === 'category') return val
    return `${dim}: ${val}`
  }
  return filter
}

export function SearchResultCard({ data, onOpenDrawer, retrievalPreferences }: SearchResultCardProps) {
  const { t } = useTranslation('common')
  const tasteProfileId = retrievalPreferences?.taste_profile_id ?? null
  const tasteProfileWeight = retrievalPreferences?.taste_profile_weight ?? 0.24
  const cachedPreview = useMemo(
    () => peekCachedSearchSessionById(
      data.search_request_id,
      0,
      DEFAULT_DRAWER_PAGE_SIZE,
      tasteProfileId,
      tasteProfileWeight,
    ),
    [data.search_request_id, tasteProfileId, tasteProfileWeight],
  )
  const [previewImages, setPreviewImages] = useState<ImageResult[]>(() => (cachedPreview?.images ?? []).slice(0, 4))
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'empty' | 'error'>(() => {
    if (data.total <= 0) return 'empty'
    if ((cachedPreview?.images ?? []).length > 0) return 'ready'
    return 'loading'
  })
  const hasFilters = data.filters_applied.length > 0
  const filterCount = data.filters_applied.length
  const summary = hasFilters
    ? t('searchResultSummaryWithFilters', { count: data.total, filters: filterCount })
    : t('searchResultSummary', { count: data.total })

  useEffect(() => {
    let cancelled = false

    if (!data.search_request_id || data.total <= 0) {
      setPreviewImages([])
      setPreviewState('empty')
      return () => {
        cancelled = true
      }
    }

    const immediate = peekCachedSearchSessionById(
      data.search_request_id,
      0,
      DEFAULT_DRAWER_PAGE_SIZE,
      tasteProfileId,
      tasteProfileWeight,
    )
    if (immediate) {
      setPreviewImages((immediate.images ?? []).slice(0, 4))
      setPreviewState((immediate.images ?? []).length > 0 ? 'ready' : 'empty')
      return () => {
        cancelled = true
      }
    }

    setPreviewImages([])
    setPreviewState('loading')

    void fetchCachedSearchSessionById(
      data.search_request_id,
      0,
      DEFAULT_DRAWER_PAGE_SIZE,
      tasteProfileId,
      tasteProfileWeight,
    )
      .then((response) => {
        if (cancelled) return
        const nextImages = (response.images ?? []).slice(0, 4)
        setPreviewImages(nextImages)
        setPreviewState(nextImages.length > 0 ? 'ready' : 'empty')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Failed to hydrate search preview', error)
        setPreviewImages([])
        setPreviewState('error')
      })

    return () => {
      cancelled = true
    }
  }, [data.search_request_id, data.total, tasteProfileId, tasteProfileWeight])

  return (
    <div className="overflow-hidden border border-border/80 bg-background animate-in fade-in slide-in-from-bottom-1 duration-normal">
      <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="type-chat-label text-foreground/84">{t('searchResultTitle')}</span>
              <span className="type-chat-meta text-muted-foreground">
                {t('imageCountWithUnit', { count: data.total })}
              </span>
            </div>
            <p className="type-chat-meta max-w-[50ch] text-muted-foreground">
              {summary}
            </p>
          </div>

          {data.total > 0 && data.search_request_id && (
            <button
              onClick={() => onOpenDrawer(data.search_request_id)}
              className="type-chat-action inline-flex min-h-8 items-center gap-1 self-start border-b border-transparent pb-0.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              {t('viewAll')}
              <ArrowRight size={11} />
            </button>
          )}
        </div>

        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-chat-kicker inline-flex items-center gap-1 text-muted-foreground">
              <Filter size={10} className="shrink-0" />
              {t('appliedFilters')}
            </span>
            {data.filters_applied.slice(0, 4).map((f, i) => (
              <span
                key={i}
                className="type-chat-kicker border border-border/70 px-2.5 py-1 text-foreground/82"
              >
                {formatFilterTag(f, t)}
              </span>
            ))}
            {data.filters_applied.length > 4 && (
              <span className="type-chat-meta text-muted-foreground">
                +{data.filters_applied.length - 4}
              </span>
            )}
          </div>
        )}

        {previewImages.length > 0 && data.search_request_id && (
          <div
            className="cursor-pointer space-y-3"
            onClick={() => onOpenDrawer(data.search_request_id)}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="type-chat-kicker text-muted-foreground">{t('resultPreview')}</span>
              <span className="type-chat-meta text-muted-foreground">{t('topImageCount', { count: previewImages.length })}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {previewImages.map((img, i) => (
                <PreviewThumbnail key={i} img={img} />
              ))}
            </div>
          </div>
        )}

        {previewState === 'loading' && data.search_request_id && data.total > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="type-chat-kicker text-muted-foreground">{t('resultPreview')}</span>
              <span className="type-chat-meta text-muted-foreground">{t('generatingResults')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="min-w-0 space-y-1.5">
                  <div className="animate-pulse bg-muted/70" style={{ aspectRatio: '1 / 2' }} />
                  <div className="h-3 w-2/3 animate-pulse bg-muted/70" />
                </div>
              ))}
            </div>
          </div>
        )}

        {previewState === 'error' && data.search_request_id && data.total > 0 && (
          <div className="type-chat-meta text-muted-foreground">
            {t('resultPreviewUnavailable')}
          </div>
        )}
      </div>
    </div>
  )
}

/** Inline preview thumbnail — 1:2 aspect ratio with bbox crop */
function PreviewThumbnail({ img }: { img: ImageResult }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div
        className="group relative overflow-hidden bg-background"
        style={{ aspectRatio: '1 / 2' }}
      >
        <FashionImage image={img} className="w-full h-full" thumbnailWidth={CHAT_THUMBNAIL_MAX_EDGE.resultPreview} />
        <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/8" />
      </div>
      {img.brand && (
        <div className="type-chat-meta truncate px-0.5 text-muted-foreground">
          {img.brand.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </div>
      )}
    </div>
  )
}
