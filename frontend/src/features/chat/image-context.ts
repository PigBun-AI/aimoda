import type { ImageResult } from './chat-types'

export interface ImageListContext {
  imageIds: string[]
  images: ImageResult[]
  createdAt: number
}

export function generateContextId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function saveImageListContext(
  contextId: string,
  images: ImageResult[]
): void {
  // Clean up expired contexts
  const prefix = 'fr_image_list_ctx_'
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) {
      const ctxStr = localStorage.getItem(key)
      if (ctxStr) {
        try {
          const ctx: ImageListContext = JSON.parse(ctxStr)
          if (Date.now() - ctx.createdAt > 30 * 60 * 1000) {
            localStorage.removeItem(key)
          }
        } catch { /* ignore */ }
      }
    }
  }
  // Store current context
  const context: ImageListContext = {
    imageIds: images.map((img) => img.image_id),
    images: images.slice(0, 500),
    createdAt: Date.now(),
  }
  localStorage.setItem(`${prefix}${contextId}`, JSON.stringify(context))
}

export function getImageListContext(contextId: string): ImageListContext | null {
  const data = localStorage.getItem(`fr_image_list_ctx_${contextId}`)
  if (!data) return null
  try {
    const context: ImageListContext = JSON.parse(data)
    if (Date.now() - context.createdAt > 30 * 60 * 1000) {
      localStorage.removeItem(`fr_image_list_ctx_${contextId}`)
      return null
    }
    return context
  } catch {
    return null
  }
}
