// ToolStep component — displays agent tool calls in the chat

import { useState } from 'react'
import { Search, Filter, Eye, Image, ChevronDown, ArrowRight, X, Palette, BarChart3, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolStep as ToolStepType, ImageResult } from './chat-types'
import { calculateBackgroundCropStyle } from './crop-utils'
import { CHAT_THUMBNAIL_MAX_EDGE, getOssThumbnailUrl } from './oss-image'

const toolIcons: Record<string, typeof Search> = {
  search: Search,
  explore_colors: Palette,
  analyze_trends: BarChart3,
  get_image_details: Info,
  start_collection: Search,
  add_filter: Filter,
  remove_filter: X,
  peek_collection: Eye,
  show_collection: Image,
}

const toolLabels: Record<string, string> = {
  search: 'toolSearch',
  explore_colors: 'toolExploreColors',
  analyze_trends: 'toolAnalyzeTrends',
  get_image_details: 'toolGetImageDetails',
  start_collection: 'toolStartCollection',
  add_filter: 'toolAddFilter',
  remove_filter: 'toolRemoveFilter',
  peek_collection: 'toolPeekCollection',
  show_collection: 'toolShowCollection',
}

/** Format brand: capitalize each word */
function formatBrand(brand: string): string {
  if (!brand) return ''
  return brand.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

interface ToolStepProps {
  step: ToolStepType
  onShowImages?: (step: ToolStepType) => void
}

export function ToolStepView({ step, onShowImages }: ToolStepProps) {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)

  const IconComp = toolIcons[step.toolName] || Search
  const label = toolLabels[step.toolName] ? t(toolLabels[step.toolName]) : step.toolName
  const args = step.args || {}

  // Summary line
  let summary = ''
  if (args.query) {
    summary = `"${args.query}"`
  }
  if (step.toolName === 'add_filter' || step.toolName === 'remove_filter') {
    const dimStr = args.dimension ? `${args.dimension}` : ''
    const valStr = args.value ? `="${args.value}"` : ''
    const catStr = args.category ? ` (on ${args.category})` : ''
    summary = `${dimStr}${valStr}${catStr}`
  }

  const hasImages = step.images && step.images.length > 0
  const hasSearchRequest = !!step.searchRequestId
  const canShowGallery = hasImages || hasSearchRequest
  const hasArgs = Object.keys(args).length > 0

  // show_collection: show inline preview thumbnails
  const showPreview = step.toolName === 'show_collection' && hasImages
  const previewImages = showPreview ? step.images!.slice(0, 6) : []

  return (
    <div className="py-1.5 animate-in fade-in slide-in-from-bottom-1 duration-normal">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-background">
          <IconComp size={15} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-sm font-medium text-foreground/80">{label}</span>
            {summary && (
              <span className="text-xs text-muted-foreground truncate max-w-[250px]">{summary}</span>
            )}
            {step.resultCount !== undefined && (
              <span className={`border px-2 py-0.5 text-xs font-medium ${
                step.resultCount === 0
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : step.matchLevel === 'partial'
                    ? 'border-border bg-muted/40 text-warning dark:text-warning'
                    : 'border-border bg-background text-primary'
              }`}>
                {t('toolResultCount', { count: step.resultCount })}
                {step.matchLevel === 'exact' && ' ✓'}
                {step.matchLevel === 'partial' && ' ≈'}
                {step.resultCount === 0 && ' ✗'}
              </span>
            )}
            {canShowGallery && onShowImages && (
              <button
                onClick={() => onShowImages(step)}
                className="inline-flex items-center gap-1 border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-all hover:bg-primary/90"
              >
                <Image size={12} />
                {t('viewAll')}
                <ArrowRight size={10} />
              </button>
            )}
            {hasArgs && step.type === 'call' && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-0.5"
              >
                {expanded ? t('collapseArgs') : t('expandArgs')}
                <ChevronDown
                  size={10}
                  className={`transition-transform duration-fast ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
            )}
          </div>

          {/* Inline thumbnail preview for show_collection */}
          {showPreview && previewImages.length > 0 && (
            <div
              className="mt-3 cursor-pointer"
              onClick={() => onShowImages?.(step)}
            >
              <div className="flex gap-2 overflow-x-auto pb-1">
                {previewImages.map((img, i) => (
                  <ThumbnailCard key={i} img={img} />
                ))}
              </div>
            </div>
          )}

          {/* Expanded args panel */}
          {expanded && hasArgs && (
            <div className="mt-2 space-y-1.5 border border-border bg-muted/30 px-3 py-2.5 animate-in fade-in duration-fast">
              {Object.entries(args).map(([key, val]) => {
                if (val === null || val === undefined || (Array.isArray(val) && val.length === 0)) return null
                return (
                  <div key={key} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground shrink-0 min-w-[80px] pt-0.5">{key}</span>
                    <span className="border border-border bg-background px-1.5 py-0.5 text-xs text-primary">
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Inline thumbnail card with bbox crop — 1:2 ratio */
function ThumbnailCard({ img }: { img: ImageResult }) {
  const thumbnailUrl = getOssThumbnailUrl(img.image_url, CHAT_THUMBNAIL_MAX_EDGE.inlineToolPreview)
  const cropStyle = calculateBackgroundCropStyle(
    img.object_area,
    img.image_url,
    CHAT_THUMBNAIL_MAX_EDGE.inlineToolPreview,
  )
  const bgStyle: React.CSSProperties = cropStyle.backgroundSize
    ? { ...cropStyle, backgroundRepeat: 'no-repeat' }
    : {
        backgroundImage: `url(${thumbnailUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundRepeat: 'no-repeat',
      }

  return (
    <div className="shrink-0 space-y-1">
      <div
        className="group relative w-[80px] overflow-hidden border border-border bg-muted"
        style={{ aspectRatio: '1 / 2' }}
      >
        <div className="w-full h-full" style={bgStyle} />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>
      {img.brand && (
        <div className="text-[10px] text-muted-foreground truncate w-[80px]">
          {formatBrand(img.brand)}
        </div>
      )}
    </div>
  )
}
