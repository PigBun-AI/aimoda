import { useRef, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageResult } from './chat-types'

/** Preset Y positions by top_category when no bbox available */
const PRESET_Y: Record<string, number> = {
  tops: 30,
  outerwear: 25,
  bottoms: 70,
  full: 45,
  footwear: 88,
  bags: 55,
  accessories: 25,
}

interface LabelData {
  xPercent: number
  yPercent: number
  name: string
  category: string
  topCategory: string
  hasBbox: boolean
}

function buildLabels(image: ImageResult): LabelData[] {
  const labels: LabelData[] = []
  // Only show tops/bottoms/full, and only the outermost (first) per top_category
  const seenTopCategories = new Set<string>()
  const ALLOWED_TOP_CATEGORIES = new Set(['tops', 'bottoms', 'full', 'outerwear'])

  for (const g of image.garments || []) {
    const tc = g.top_category || ''
    if (!ALLOWED_TOP_CATEGORIES.has(tc)) continue
    if (seenTopCategories.has(tc)) continue
    seenTopCategories.add(tc)

    if (g.bbox) {
      const [x1, y1, x2, y2] = g.bbox
      const centerX = ((x1 + x2) / 2) * 100
      const centerY = ((y1 + y2) / 2) * 100
      labels.push({
        xPercent: centerX,
        yPercent: centerY,
        name: g.name,
        category: g.category,
        topCategory: tc,
        hasBbox: true,
      })
    } else {
      const yPreset = PRESET_Y[tc] || 50
      let xPreset = 50
      if (image.object_area?.bbox_range_percent) {
        const bp = image.object_area.bbox_range_percent
        xPreset = (bp.startX_percent + bp.endX_percent) / 2
      }
      labels.push({
        xPercent: xPreset,
        yPercent: yPreset,
        name: g.name,
        category: g.category,
        topCategory: tc,
        hasBbox: false,
      })
    }
  }

  return labels
}

interface ImageLabelsProps {
  image: ImageResult
  onLabelSearch?: (label: { name: string; category: string; topCategory: string }) => void | Promise<void>
  activeLabelKey?: string | null
}

export function ImageLabels({ image, onLabelSearch, activeLabelKey = null }: ImageLabelsProps) {
  const { t } = useTranslation('common')
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setContainerSize({ width: rect.width, height: rect.height })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  const labels = buildLabels(image)
  if (labels.length === 0) return null

  const LINE_LENGTH = 80

  const handleLabelClick = async (label: LabelData) => {
    await onLabelSearch?.({
      name: label.name,
      category: label.category,
      topCategory: label.topCategory,
    })
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ overflow: 'visible' }}
    >
      {labels.map((label, index) => {
        const preferLeft =
          label.topCategory === 'bottoms' ||
          (label.topCategory === 'footwear' && label.xPercent < 50)

        const containerWidth = containerSize.width || 600
        const labelAnchorX = (label.xPercent / 100) * containerWidth
        const availableRightPx = Math.max(0, containerWidth - labelAnchorX - 16)
        const availableLeftPx = Math.max(0, labelAnchorX - 16)
        const estimatedLabelWidth = Math.min(240, Math.max(96, label.name.length * 8 + 28))
        const shouldFlipToLeft = !preferLeft && availableRightPx < estimatedLabelWidth && availableLeftPx > availableRightPx
        const shouldFlipToRight = preferLeft && availableLeftPx < estimatedLabelWidth && availableRightPx > availableLeftPx
        const isLeft = shouldFlipToLeft ? true : shouldFlipToRight ? false : preferLeft
        const availableLabelWidth = isLeft ? availableLeftPx : availableRightPx
        const safeLabelWidth = Math.max(92, Math.min(220, availableLabelWidth - 10))
        const lineLengthPercent =
          containerWidth > 0 ? (LINE_LENGTH / containerWidth) * 100 : 15
        const lineEndX = isLeft
          ? Math.max(0, label.xPercent - lineLengthPercent)
          : Math.min(100, label.xPercent + lineLengthPercent)

        const displayName = label.name
        const isSearching = activeLabelKey === `${label.category}:${label.topCategory}:${label.name}`.toLowerCase()

        return (
          <div key={index} className="absolute inset-0">
            {/* Dashed line + dot */}
            <svg
              className="absolute inset-0 w-full h-full"
              style={{ pointerEvents: 'none', overflow: 'visible' }}
            >
              <line
                x1={`${label.xPercent}%`}
                y1={`${label.yPercent}%`}
                x2={`${lineEndX}%`}
                y2={`${label.yPercent}%`}
                stroke="#fff"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.9"
              />
              <circle
                cx={`${label.xPercent}%`}
                cy={`${label.yPercent}%`}
                r="4"
                fill="white"
                stroke="#000"
                strokeWidth="1"
                opacity="0.9"
              />
            </svg>

            {/* Label text — clickable, triggers inline search */}
            <div
              className={`absolute border border-border bg-white/95 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-black shadow-sm pointer-events-auto cursor-pointer hover:bg-white hover:shadow-md transition-all ${isSearching ? 'opacity-70' : ''}`}
              style={{
                left: isLeft ? 'auto' : `${lineEndX}%`,
                right: isLeft ? `${100 - lineEndX}%` : 'auto',
                marginLeft: isLeft ? 'auto' : '2px',
                marginRight: isLeft ? '2px' : 'auto',
                top: `${label.yPercent}%`,
                transform: 'translateY(-50%)',
                width: `${safeLabelWidth}px`,
                maxWidth: `${safeLabelWidth}px`,
                minWidth: '92px',
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                lineHeight: 1.25,
              }}
              title={t('searchSimilarGarment', { name: displayName })}
              onClick={(e) => {
                e.stopPropagation()
                void handleLabelClick(label)
              }}
            >
              <span className="flex items-center gap-1.5">
                <span className="block flex-1 break-words text-left">{displayName}</span>
                {isSearching && (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                )}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
