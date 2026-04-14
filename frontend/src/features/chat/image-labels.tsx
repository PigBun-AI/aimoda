import { useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  anchorBox: { left: number; top: number; width: number; height: number }
  onLabelSearch?: (label: { name: string; category: string; topCategory: string }) => void | Promise<void>
  activeLabelKey?: string | null
}

interface LabelPlacement {
  left: number
  top: number
  lineEndX: number
  lineEndY: number
}

const LABEL_MARGIN = 14
const LABEL_GAP = 8

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getLabelKey(label: LabelData) {
  return `${label.category}:${label.topCategory}:${label.name}`.toLowerCase()
}

export function ImageLabels({ image, anchorBox, onLabelSearch, activeLabelKey = null }: ImageLabelsProps) {
  const { t } = useTranslation('common')
  const containerRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [placements, setPlacements] = useState<Record<string, LabelPlacement>>({})
  const labels = useMemo(() => buildLabels(image), [image])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || labels.length === 0) return

    const computePlacements = () => {
      const containerRect = container.getBoundingClientRect()
      const lineLength = Math.max(46, Math.min(94, anchorBox.width * 0.16))
      const nextPlacements: Record<string, LabelPlacement> = {}

      labels.forEach((label) => {
        const key = getLabelKey(label)
        const element = labelRefs.current[key]
        if (!element) return

        const labelRect = element.getBoundingClientRect()
        const labelWidth = labelRect.width
        const labelHeight = labelRect.height
        const anchorX = anchorBox.left + (label.xPercent / 100) * anchorBox.width
        const anchorY = anchorBox.top + (label.yPercent / 100) * anchorBox.height

        const preferredLeft =
          label.topCategory === 'bottoms' ||
          label.topCategory === 'footwear' ||
          (label.topCategory === 'outerwear' && label.xPercent > 56)

        const freeRight = containerRect.width - LABEL_MARGIN - anchorX
        const freeLeft = anchorX - LABEL_MARGIN
        const requiredWidth = lineLength + LABEL_GAP + labelWidth

        const canPlaceRight = freeRight >= requiredWidth
        const canPlaceLeft = freeLeft >= requiredWidth

        let placeLeft = preferredLeft
        if (placeLeft && !canPlaceLeft && canPlaceRight) placeLeft = false
        if (!placeLeft && !canPlaceRight && canPlaceLeft) placeLeft = true
        if (!canPlaceLeft && !canPlaceRight) placeLeft = freeLeft > freeRight

        const intendedLeft = placeLeft
          ? anchorX - lineLength - LABEL_GAP - labelWidth
          : anchorX + lineLength + LABEL_GAP

        const clampedLeft = clamp(intendedLeft, LABEL_MARGIN, containerRect.width - labelWidth - LABEL_MARGIN)
        const clampedTop = clamp(anchorY - labelHeight / 2, LABEL_MARGIN, containerRect.height - labelHeight - LABEL_MARGIN)

        nextPlacements[key] = {
          left: clampedLeft,
          top: clampedTop,
          lineEndX: placeLeft ? clampedLeft + labelWidth : clampedLeft,
          lineEndY: clampedTop + labelHeight / 2,
        }
      })

      setPlacements(nextPlacements)
    }

    computePlacements()

    const resizeObserver = new ResizeObserver(() => computePlacements())
    resizeObserver.observe(container)

    Object.values(labelRefs.current).forEach((element) => {
      if (element) resizeObserver.observe(element)
    })

    return () => resizeObserver.disconnect()
  }, [anchorBox.height, anchorBox.left, anchorBox.top, anchorBox.width, labels])

  if (labels.length === 0) return null

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
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
    >
      <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none', overflow: 'visible' }}>
        {labels.map((label) => {
          const key = getLabelKey(label)
          const placement = placements[key]
          if (!placement) return null

          const labelAnchorX = anchorBox.left + (label.xPercent / 100) * anchorBox.width
          const labelAnchorY = anchorBox.top + (label.yPercent / 100) * anchorBox.height

          return (
            <g key={`${key}-line`}>
              <polyline
                points={`${labelAnchorX},${labelAnchorY} ${placement.lineEndX},${labelAnchorY} ${placement.lineEndX},${placement.lineEndY}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="4 4"
                className="text-foreground/90"
              />
              <circle
                cx={labelAnchorX}
                cy={labelAnchorY}
                r="4"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1"
                className="text-foreground"
              />
            </g>
          )
        })}
      </svg>

      {labels.map((label) => {
        const key = getLabelKey(label)
        const placement = placements[key]
        const labelAnchorX = anchorBox.left + (label.xPercent / 100) * anchorBox.width
        const labelAnchorY = anchorBox.top + (label.yPercent / 100) * anchorBox.height
        const displayName = label.name
        const isSearching = activeLabelKey === key

        return (
          <button
            key={key}
            ref={(element) => {
              labelRefs.current[key] = element
            }}
            type="button"
            className={`type-chat-kicker pointer-events-auto absolute inline-flex max-w-[min(220px,28vw)] cursor-pointer items-center gap-1.5 border border-border bg-background px-2.5 py-1.5 text-left text-foreground transition-all hover:border-foreground/25 hover:bg-accent/20 ${isSearching ? 'opacity-70' : ''}`}
            style={{
              left: `${placement?.left ?? labelAnchorX}px`,
              top: `${placement?.top ?? labelAnchorY}px`,
              visibility: placement ? 'visible' : 'hidden',
            }}
            title={t('searchSimilarGarment', { name: displayName })}
            onClick={(event) => {
              event.stopPropagation()
              void handleLabelClick(label)
            }}
          >
            <span
              className="block break-words leading-[1.24]"
              style={{ hyphens: 'auto' }}
            >
              {displayName}
            </span>
            {isSearching && (
              <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
            )}
          </button>
        )
      })}
    </div>
  )
}
