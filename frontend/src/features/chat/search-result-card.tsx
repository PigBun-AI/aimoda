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
    <div className="overflow-hidden border border-border bg-card animate-in fade-in slide-in-from-bottom-1 duration-normal">
      <div className="grid gap-5 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-background">
            <Images size={15} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <span className="type-ui-title-md text-foreground">{t('searchResultTitle')}</span>
              <span className="type-kicker text-muted-foreground">
                {t('imageCountWithUnit', { count: data.total })}
              </span>
            </div>
            <p className="type-ui-body-md mt-2 max-w-[52ch] text-muted-foreground">
              {summary}
            </p>
            {hasFilters && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="type-kicker inline-flex items-center gap-1 text-muted-foreground">
                  <Filter size={10} className="shrink-0" />
                  {t('appliedFilters')}
                </span>
                {data.filters_applied.slice(0, 4).map((f, i) => (
                  <span
                    key={i}
                    className="type-kicker border border-border bg-background px-2 py-1 text-foreground"
                  >
                    {formatFilterTag(f)}
                  </span>
                ))}
                {data.filters_applied.length > 4 && (
                  <span className="type-caption text-muted-foreground">
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
            className="type-action-label inline-flex min-h-11 items-center gap-2 self-start border border-border bg-background px-4 text-foreground transition-colors hover:border-foreground hover:bg-accent"
          >
            {t('viewAll')}
            <ArrowRight size={11} />
          </button>
        )}
      </div>

      {previewImages.length > 0 && data.search_request_id && (
        <div
          className="cursor-pointer px-5 pb-5"
          onClick={() => onOpenDrawer(data.search_request_id)}
        >
          <div className="border border-border bg-muted/15 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="type-label text-foreground">{t('resultPreview')}</span>
              <span className="type-meta text-muted-foreground">{t('topImageCount', { count: 4 })}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {previewImages.map((img, i) => (
                <PreviewThumbnail key={i} img={img} />
              ))}
            </div>
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
        className="group relative overflow-hidden border border-border bg-muted"
        style={{ aspectRatio: '1 / 2' }}
      >
        <FashionImage image={img} className="w-full h-full" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>
      {img.brand && (
        <div className="type-meta truncate px-0.5 text-muted-foreground">
          {img.brand.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </div>
      )}
    </div>
  )
}
