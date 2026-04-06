import { calculateBackgroundCropStyle } from './crop-utils'
import { CHAT_THUMBNAIL_MAX_EDGE, getOssThumbnailUrl } from './oss-image'
import type { ImageResult } from './chat-types'

interface FashionImageProps {
  image: ImageResult
  className?: string
  fallbackClassName?: string
  thumbnailWidth?: number
}

export function FashionImage({
  image,
  className,
  fallbackClassName,
  thumbnailWidth = CHAT_THUMBNAIL_MAX_EDGE.contentImage,
}: FashionImageProps) {
  const thumbnailUrl = getOssThumbnailUrl(image.image_url, thumbnailWidth)
  const cropStyle = calculateBackgroundCropStyle(image.object_area, image.image_url, thumbnailWidth)
  const style: React.CSSProperties = cropStyle.backgroundSize
    ? cropStyle
    : {
        backgroundImage: `url(${thumbnailUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }

  return (
    <div className={className}>
      <div
        className={fallbackClassName ?? 'h-full w-full bg-muted'}
        style={style}
        role="img"
        aria-label={image.brand || 'fashion image'}
      />
    </div>
  )
}
