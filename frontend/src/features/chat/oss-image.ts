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
 * @param maxEdge - Maximum rendered edge in pixels
 * @returns Thumbnail URL with OSS processing params, or original URL if not an OSS URL
 *
 * @example
 * getOssThumbnailUrl('https://bucket.oss-cn-hangzhou.aliyuncs.com/img.jpg', 1280)
 * // => 'https://bucket.oss-cn-hangzhou.aliyuncs.com/img.jpg?x-oss-process=image/resize,w_1280,h_1280,m_lfit/format,webp'
 */
export function getOssThumbnailUrl(url: string, maxEdge: number): string {
  if (!url || !url.includes('aliyuncs.com')) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}x-oss-process=image/resize,w_${maxEdge},h_${maxEdge},m_lfit/format,webp`
}
