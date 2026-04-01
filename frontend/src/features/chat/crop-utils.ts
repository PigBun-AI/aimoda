/**
 * calculateBackgroundCropStyle — 从 aimoda-web 移植
 *
 * 使用 object_area.bbox_range_percent 计算 background-image 裁剪样式，
 * 让容器以 1:2 比例（aspectRatio "1/2"）均匀展示模特人物区域。
 */

/** 裁切区域周围的留白百分比 */
const CROP_PADDING_PERCENT = 5

/** 容器固定宽高比 (1:2) */
const CONTAINER_RATIO = 0.5

import { getOssThumbnailUrl } from './oss-image'

export interface ObjectArea {
  bbox_range_percent: {
    startX_percent: number
    startY_percent: number
    endX_percent: number
    endY_percent: number
  }
  image_width: number
  image_height: number
}

export function calculateBackgroundCropStyle(
  objectArea?: ObjectArea | null,
  imageUrl?: string,
  thumbnailWidth?: number,
): React.CSSProperties {
  // Apply OSS thumbnail if width specified
  const displayUrl = thumbnailWidth && imageUrl
    ? getOssThumbnailUrl(imageUrl, thumbnailWidth)
    : imageUrl

  if (
    !objectArea?.bbox_range_percent ||
    !objectArea?.image_width ||
    !objectArea?.image_height
  ) {
    return {}
  }

  try {
    const {
      startX_percent = 0,
      endX_percent = 100,
      startY_percent = 0,
      endY_percent = 100,
    } = objectArea.bbox_range_percent

    const { image_width, image_height } = objectArea

    // 验证数据有效性
    if (
      startX_percent < 0 || startX_percent > 100 ||
      endX_percent < 0 || endX_percent > 100 ||
      startY_percent < 0 || startY_percent > 100 ||
      endY_percent < 0 || endY_percent > 100 ||
      startX_percent >= endX_percent ||
      startY_percent >= endY_percent ||
      !image_width || !image_height
    ) {
      return {}
    }

    // bbox 尺寸（百分比）
    const cropHeight = endY_percent - startY_percent

    // 原图宽高比
    const imageRatio = image_width / image_height

    // 应用留白
    const adjustedCropHeight = cropHeight * (1 + CROP_PADDING_PERCENT / 100)

    // 缩放比例：让调整后的 bbox 高度填满容器高度
    const scale = 100 / adjustedCropHeight

    // background-size
    const bgHeight = scale * 100
    const bgWidth = ((scale * imageRatio) / CONTAINER_RATIO) * 100

    // background-position
    const bboxCenterX = (startX_percent + endX_percent) / 2
    const posX = bboxCenterX

    const heightExpansion = adjustedCropHeight - cropHeight
    const adjustedStartY = startY_percent - heightExpansion / 2

    const denominator = bgHeight - 100
    const posY =
      Math.abs(denominator) < 0.01
        ? adjustedStartY
        : (adjustedStartY * bgHeight) / denominator

    return {
      backgroundImage: displayUrl ? `url(${displayUrl})` : undefined,
      backgroundSize: `${bgWidth}% ${bgHeight}%`,
      backgroundPosition: `${posX}% ${posY}%`,
      backgroundRepeat: 'no-repeat',
    }
  } catch {
    return {}
  }
}

export interface ImagePlacement {
  widthPercent: number
  leftPercent: number
  topPercent: number
}

const DEFAULT_BBOX_TOP_PADDING_PERCENT = 6

export function calculateImagePlacement(
  objectArea?: ObjectArea | null,
  topPaddingPercent = DEFAULT_BBOX_TOP_PADDING_PERCENT,
): ImagePlacement | null {
  if (
    !objectArea?.bbox_range_percent ||
    !objectArea?.image_width ||
    !objectArea?.image_height
  ) {
    return null
  }

  try {
    const {
      startX_percent = 0,
      endX_percent = 100,
      startY_percent = 0,
      endY_percent = 100,
    } = objectArea.bbox_range_percent

    if (
      startX_percent < 0 || startX_percent > 100 ||
      endX_percent < 0 || endX_percent > 100 ||
      startY_percent < 0 || startY_percent > 100 ||
      endY_percent < 0 || endY_percent > 100 ||
      startX_percent >= endX_percent ||
      startY_percent >= endY_percent
    ) {
      return null
    }

    const containerWidth = 100
    const containerHeight = 200
    const desiredTopPadding = containerHeight * (topPaddingPercent / 100)

    const bboxTopPx = (startY_percent / 100) * objectArea.image_height
    const bboxHeightPx = ((endY_percent - startY_percent) / 100) * objectArea.image_height
    const bboxCenterXPx =
      (((startX_percent + endX_percent) / 2) / 100) * objectArea.image_width

    if (bboxHeightPx <= 0) return null

    // Only use bbox top + bbox height to size and position the image.
    // Do not clamp by left/right/bottom so the image can overflow naturally
    // instead of looking squeezed inside the container.
    const targetBboxHeight = containerHeight - desiredTopPadding
    const scale = targetBboxHeight / bboxHeightPx
    const renderedWidth = scale * objectArea.image_width
    const left = containerWidth / 2 - scale * bboxCenterXPx
    const top = desiredTopPadding - scale * bboxTopPx

    return {
      widthPercent: renderedWidth,
      leftPercent: left,
      topPercent: (top / containerHeight) * 100,
    }
  } catch {
    return null
  }
}
