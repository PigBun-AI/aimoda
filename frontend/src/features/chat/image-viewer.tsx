import { useState, useRef, useCallback, useEffect } from 'react'
import { Loader2, MousePointerClick } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ImageResult } from './chat-types'
import { ImageLabels } from './image-labels'

interface ImageViewerProps {
  image: ImageResult
  activeLabelKey?: string | null
  onLabelSearch?: (label: { name: string; category: string; topCategory: string }) => void | Promise<void>
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4
const DOUBLE_TAP_SCALES = [1, 2]

export function ImageViewer({ image, activeLabelKey = null, onLabelSearch }: ImageViewerProps) {
  const { t } = useTranslation('common')
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(true)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const [frameBox, setFrameBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const lastTap = useRef<number>(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
    setLoading(true)
    setAspectRatio(null)
    setFrameBox(null)
  }, [image.image_id])

  useEffect(() => {
    const container = containerRef.current
    const frame = frameRef.current
    if (!container || !frame) return

    const updateFrameBox = () => {
      const containerRect = container.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      setFrameBox({
        left: frameRect.left - containerRect.left,
        top: frameRect.top - containerRect.top,
        width: frameRect.width,
        height: frameRect.height,
      })
    }

    updateFrameBox()

    const resizeObserver = new ResizeObserver(() => updateFrameBox())
    resizeObserver.observe(container)
    resizeObserver.observe(frame)
    window.addEventListener('resize', updateFrameBox)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateFrameBox)
    }
  }, [aspectRatio, image.image_id])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setScale(prev => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta))
        if (next <= 1) setPosition({ x: 0, y: 0 })
        return next
      })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      px: position.x,
      py: position.y,
    }
  }, [position.x, position.y, scale])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !dragStart.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPosition({
      x: dragStart.current.px + dx,
      y: dragStart.current.py + dy,
    })
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    dragStart.current = null
  }, [])

  const handleDoubleClick = useCallback(() => {
    const now = Date.now()
    if (now - lastTap.current < 300) {
      const currentIndex = DOUBLE_TAP_SCALES.indexOf(scale)
      const nextIndex = (currentIndex + 1) % DOUBLE_TAP_SCALES.length
      const nextScale = DOUBLE_TAP_SCALES[nextIndex]
      setScale(nextScale)
      if (nextScale <= 1) {
        setPosition({ x: 0, y: 0 })
      }
      lastTap.current = 0
      if (tapTimer.current) clearTimeout(tapTimer.current)
    } else {
      lastTap.current = now
      tapTimer.current = setTimeout(() => {
        lastTap.current = 0
      }, 300)
    }
  }, [scale])

  const cursorStyle = scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
  const showHint = scale <= 1

  return (
    <div
      ref={containerRef}
      className={`group/viewer relative flex h-full min-h-[min(62svh,720px)] w-full items-center justify-center p-4 sm:min-h-[min(68svh,820px)] sm:p-6 lg:min-h-0 lg:p-8 ${cursorStyle}`}
      style={{ overflow: 'hidden' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-muted-foreground" />
        </div>
      )}

      {showHint && !loading && (
        <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 border border-border bg-background px-3 py-2">
          <MousePointerClick size={14} className="shrink-0 text-muted-foreground" />
          <span className="type-chat-kicker whitespace-nowrap text-muted-foreground">
            {t('imageInteractionHint')}
          </span>
        </div>
      )}

      <div
        ref={frameRef}
        className="relative flex items-center justify-center border border-border bg-background"
        style={{
          overflow: 'hidden',
          aspectRatio: aspectRatio ? `${aspectRatio}` : '2 / 3',
          height: '100%',
          maxHeight: '100%',
          maxWidth: '100%',
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        <img
          src={image.image_url}
          alt={image.brand || 'fashion image'}
          className="h-full w-full select-none object-contain"
          onLoad={(event) => {
            const target = event.currentTarget
            if (target.naturalWidth > 0 && target.naturalHeight > 0) {
              setAspectRatio(target.naturalWidth / target.naturalHeight)
            }
            setLoading(false)
          }}
          onError={() => setLoading(false)}
          draggable={false}
        />
      </div>

      {showHint && !loading && frameBox && (
        <ImageLabels
          image={image}
          anchorBox={frameBox}
          activeLabelKey={activeLabelKey}
          onLabelSearch={onLabelSearch}
        />
      )}
    </div>
  )
}
