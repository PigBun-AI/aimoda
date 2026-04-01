/**
 * OSS Image Processing — thumbnail URL builder.
 *
 * Leverages Aliyun OSS's built-in image processing to generate
 * thumbnails on-the-fly via URL parameters. Zero storage cost,
 * cached at CDN edge nodes.
 *
 * @see https://help.aliyun.com/document_detail/44688.html
 */

/**
 * Generate a thumbnail URL using OSS image processing.
 *
 * @param url  - Original OSS image URL
 * @param width - Target width in pixels (height scales proportionally)
 * @returns Thumbnail URL with OSS processing params, or original URL if not an OSS URL
 *
 * @example
 * getOssThumbnailUrl('https://bucket.oss-cn-hangzhou.aliyuncs.com/img.jpg', 400)
 * // => 'https://bucket.oss-cn-hangzhou.aliyuncs.com/img.jpg?x-oss-process=image/resize,w_400,m_lfit/format,webp'
 */
export function getOssThumbnailUrl(url: string, width: number): string {
  if (!url || !url.includes('aliyuncs.com')) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}x-oss-process=image/resize,w_${width},m_lfit/format,webp`
}
