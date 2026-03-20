// ImageDrawer — 结果面板（仿 aimoda-web ResultPanelContainer）

import { X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DrawerData } from './chat-types'
import { FashionImage } from './fashion-image'

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
  onClose: () => void
  onLoadMore: () => void
}

export function ImageDrawer({ open, data, onClose, onLoadMore }: ImageDrawerProps) {
  if (!open || !data) return null

  const safeImages = data.images || []
  const displayCount = data.total || safeImages.length

  return (
    <div className="h-full flex flex-col animate-in slide-in-from-right duration-normal border-l border-border bg-background">
      {/* Header — 仿 aimoda-web HeaderCommon */}
      <div className="flex items-end justify-between pb-3.5 h-15 pl-4 pr-4 sm:pl-9 sm:pr-8 shrink-0 border-b border-border">
        <div className="flex items-end gap-2">
          <div className="text-xl font-bold leading-[24px]">AI检索结果</div>
          <div className="text-sm text-muted-foreground mb-0.5">
            ({safeImages.length}
            {displayCount > safeImages.length ? ` / ${displayCount}` : ''} 张图片)
          </div>
        </div>
        <div className="flex items-end">
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Image grid — 仿 aimoda-web GalleryLayout */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pt-1">
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(186px, 1fr))',
            gap: '24px 16px',
          }}
        >
          {safeImages.map((img, i) => (
            <div key={i} className="space-y-2 w-full">
              {/* Image card — 1:2 ratio with bbox crop */}
              <div
                className="relative group overflow-hidden bg-muted w-full transition-all border border-border/70 hover:border-primary/40 hover:shadow-md"
                style={{ aspectRatio: '1 / 2', width: '100%' }}
              >
                <FashionImage image={img} className="w-full h-full" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
              </div>

              {/* Image info — 仿 aimoda-web ImageCardBase gallery mode */}
              <div className="space-y-0.5 text-left">
                {img.year != null && (
                  <div className="text-xs text-muted-foreground">
                    {String(img.year)}
                  </div>
                )}
                {img.brand && (
                  <div className="text-sm font-medium text-foreground">
                    {formatBrand(img.brand)}
                  </div>
                )}
                {img.quarter && (
                  <div className="text-xs text-muted-foreground truncate">
                    {img.quarter}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {data.hasMore && (
          <div className="flex flex-col items-center justify-center mt-8 mb-4 gap-3">
            <Button
              variant="outline"
              className="px-8 rounded-full"
              onClick={onLoadMore}
              disabled={data.isLoadingMore}
            >
              {data.isLoadingMore ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  加载中...
                </>
              ) : (
                '加载更多'
              )}
            </Button>
          </div>
        )}

        {!data.hasMore && safeImages.length > 0 && (
          <p className="text-center text-muted-foreground text-sm mt-8 pb-2">已加载全部图片</p>
        )}
      </div>
    </div>
  )
}
