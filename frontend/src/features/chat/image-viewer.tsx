import { useState, useRef, useCallback, useEffect } from 'react'
import { Loader2, MousePointerClick } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageResult } from './chat-types'
import type { SearchResponse } from './chat-api'
import { ImageLabels } from './image-labels'

interface ImageViewerProps {
  image: ImageResult
  onSearchResult?: (results: SearchResponse, labelName: string, searchType?: string, params?: any) => void
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4
const DOUBLE_TAP_SCALES = [1, 2]

export function ImageViewer({ image, onSearchResult }: ImageViewerProps) {
  const { t } = useTranslation('common')
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(true)
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const lastTap = useRef<number>(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset when image changes
  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
    setLoading(true)
  }, [image.image_id])

  const containerRef = useRef<HTMLDivElement>(null)

  // Use native wheel listener with passive:false to allow preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Always prevent page scroll when wheeling over the image
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setScale((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta))
        if (next <= 1) setPosition({ x: 0, y: 0 })
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scale])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale <= 1) return
      e.preventDefault()
      setIsDragging(true)
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        px: position.x,
        py: position.y,
      }
    },
    [scale, position],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !dragStart.current) return
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setPosition({
        x: dragStart.current.px + dx,
        y: dragStart.current.py + dy,
      })
    },
    [isDragging],
  )

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
      className={`w-full h-full flex items-center justify-center p-4 relative group/viewer ${cursorStyle}`}
      style={{ overflow: 'hidden' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* Loading spinner */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Loader2 size={32} className="animate-spin text-muted-foreground" />
        </div>
      )}

      {/* 底部居中交互提示 */}
      {showHint && !loading && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-2 bg-black/60 backdrop-blur-sm rounded-lg">
          <MousePointerClick size={14} className="text-white/80 flex-shrink-0" />
          <span className="text-xs text-white/90 whitespace-nowrap">
            {t('imageInteractionHint')}
          </span>
        </div>
      )}

      {/* Image container */}
      <div
        className="relative flex items-center justify-center max-h-[calc(100vh-56px)]"
        style={{
          overflow: 'hidden',
          aspectRatio: '2/3',
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        <img
          src={image.image_url}
          alt={image.brand || 'fashion image'}
          className="h-full w-full object-contain select-none"
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
          draggable={false}
        />
        {showHint && !loading && <ImageLabels image={image} onSearchResult={onSearchResult} />}
      </div>
    </div>
  )
}
