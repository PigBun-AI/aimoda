import { useCallback } from 'react'
import { Download, Heart, Link2 } from 'lucide-react'
import type { ImageResult } from './chat-types'

interface ImageActionBarProps {
  image: ImageResult
}

export function ImageActionBar({ image }: ImageActionBarProps) {
  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = image.image_url
    a.download = `${image.image_id}-${image.brand || 'fashion'}.jpg`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [image])

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(image.image_url)
    } catch {
      // silent fail
    }
  }, [image])

  return (
    <div
      className="w-full lg:w-[60px] shrink-0 flex lg:flex-col items-center justify-center lg:justify-end gap-4 p-4 lg:pb-8"
    >
      <button
        type="button"
        onClick={handleCopyLink}
        className="transition-opacity hover:opacity-70"
        title="复制链接"
        aria-label="复制链接"
      >
        <Link2 className="w-7 h-7 text-foreground" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        onClick={handleDownload}
        className="transition-opacity hover:opacity-70"
        title="下载"
        aria-label="下载"
      >
        <Download className="w-7 h-7 text-foreground" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="transition-opacity hover:opacity-70"
        title="收藏"
        aria-label="收藏"
      >
        <Heart className="w-7 h-7 text-foreground" strokeWidth={1.5} />
      </button>
    </div>
  )
}
