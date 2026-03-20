import { calculateBackgroundCropStyle } from './crop-utils'
import type { ImageResult } from './chat-types'

interface FashionImageProps {
  image: ImageResult
  className?: string
  fallbackClassName?: string
}

export function FashionImage({ image, className, fallbackClassName }: FashionImageProps) {
  const cropStyle = calculateBackgroundCropStyle(image.object_area, image.image_url)
  const style: React.CSSProperties = cropStyle.backgroundSize
    ? cropStyle
    : {
        backgroundImage: `url(${image.image_url})`,
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
