// SearchResultCard — show_collection tool result rendered as a rich card
// Displays result count, filters, preview thumbnails, and triggers drawer

import { Images, Filter, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SearchResultData, ImageResult } from './chat-types'
import { FashionImage } from './fashion-image'

interface SearchResultCardProps {
  data: SearchResultData
  images?: ImageResult[]
  onOpenDrawer: (searchRequestId: string) => void
}

/** Format filter tag for display: "category=dress" → "dress" */
function formatFilterTag(filter: string): string {
  const parts = filter.split('=')
  if (parts.length === 2) {
    const [dim, val] = parts
    // Show dimension:value for garment tags, just value for simple ones
    if (dim === 'category') return val
    return `${dim}: ${val}`
  }
  return filter
}

export function SearchResultCard({ data, images, onOpenDrawer }: SearchResultCardProps) {
  const { t } = useTranslation('common')
  const previewImages = (images?.length ? images : data.sample_images)?.slice(0, 4) ?? []
  const hasFilters = data.filters_applied.length > 0
  const filterCount = data.filters_applied.length
  const summary = hasFilters
    ? t('searchResultSummaryWithFilters', { count: data.total, filters: filterCount })
    : t('searchResultSummary', { count: data.total })

  return (
    <div className="overflow-hidden border border-border/70 bg-background/50 animate-in fade-in slide-in-from-bottom-1 duration-normal">
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border/70 bg-muted/16">
            <Images size={14} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="type-ui-label-sm text-foreground">{t('searchResultTitle')}</span>
              <span className="type-ui-label-xs text-muted-foreground">
                {t('imageCountWithUnit', { count: data.total })}
              </span>
            </div>
            <p className="type-ui-meta mt-1.5 max-w-[52ch] text-muted-foreground">
              {summary}
            </p>
            {hasFilters && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="type-ui-label-xs inline-flex items-center gap-1 text-muted-foreground">
                  <Filter size={10} className="shrink-0" />
                  {t('appliedFilters')}
                </span>
                {data.filters_applied.slice(0, 4).map((f, i) => (
                  <span
                    key={i}
                    className="type-ui-label-xs border border-border/70 bg-background px-1.5 py-1 text-foreground"
                  >
                    {formatFilterTag(f)}
                  </span>
                ))}
                {data.filters_applied.length > 4 && (
                  <span className="type-ui-meta text-muted-foreground">
                    +{data.filters_applied.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {data.total > 0 && data.search_request_id && (
          <button
            onClick={() => onOpenDrawer(data.search_request_id)}
            className="type-ui-label-sm inline-flex min-h-9 items-center gap-1.5 self-start border border-transparent px-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('viewAll')}
            <ArrowRight size={11} />
          </button>
        )}
      </div>

      {previewImages.length > 0 && data.search_request_id && (
        <div
          className="cursor-pointer border-t border-border/70 px-4 py-4"
          onClick={() => onOpenDrawer(data.search_request_id)}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="type-ui-label-xs text-foreground">{t('resultPreview')}</span>
            <span className="type-ui-meta text-muted-foreground">{t('topImageCount', { count: 4 })}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {previewImages.map((img, i) => (
              <PreviewThumbnail key={i} img={img} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline preview thumbnail — 1:2 aspect ratio with bbox crop */
function PreviewThumbnail({ img }: { img: ImageResult }) {
  return (
    <div className="space-y-1 min-w-0">
      <div
        className="group relative overflow-hidden border border-border/70 bg-muted/30"
        style={{ aspectRatio: '1 / 2' }}
      >
        <FashionImage image={img} className="w-full h-full" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>
      {img.brand && (
        <div className="type-ui-meta truncate px-0.5 text-muted-foreground">
          {img.brand.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </div>
      )}
    </div>
  )
}
