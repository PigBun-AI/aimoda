// SearchResultCard — show_collection tool result rendered as a rich card
// Displays result count, filters, preview thumbnails, and triggers drawer

import { Images, Filter, ArrowRight } from 'lucide-react'
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
  const previewImages = (images?.length ? images : data.sample_images)?.slice(0, 4) ?? []
  const hasFilters = data.filters_applied.length > 0

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-normal shadow-sm">
      {/* Header */}
      <div className="px-3 sm:px-4 py-3 sm:py-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
            <Images size={15} className="text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">检索结果</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/15 text-primary">
                {data.total} 张图片
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {data.message}
            </p>
            {hasFilters && (
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <Filter size={10} className="text-muted-foreground shrink-0" />
                {data.filters_applied.slice(0, 4).map((f, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                  >
                    {formatFilterTag(f)}
                  </span>
                ))}
                {data.filters_applied.length > 4 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{data.filters_applied.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {data.total > 0 && data.search_request_id && (
            <button
              onClick={() => onOpenDrawer(data.search_request_id)}
              className="inline-flex items-center gap-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1.5 rounded-full transition-all font-medium shadow-sm whitespace-nowrap"
            >
              查看全部
              <ArrowRight size={10} />
            </button>
          )}
        </div>
      </div>

          {previewImages.length > 0 && data.search_request_id && (
            <div
              className="px-4 pb-4 cursor-pointer"
              onClick={() => onOpenDrawer(data.search_request_id)}
            >
          <div className="border border-border/60 bg-muted/25 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-foreground/75">结果预览</span>
              <span className="text-[10px] text-muted-foreground">前 4 张</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
        className="bg-muted overflow-hidden group relative border border-border/60"
        style={{ aspectRatio: '1 / 2' }}
      >
        <FashionImage image={img} className="w-full h-full" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>
      {img.brand && (
        <div className="text-[9px] text-muted-foreground truncate px-0.5">
          {img.brand.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </div>
      )}
    </div>
  )
}
