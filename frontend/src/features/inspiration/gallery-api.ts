/**
 * Gallery API — fetch galleries from backend
 */

const TOKEN_KEY = 'fashion-report-access-token'

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = window.localStorage.getItem(TOKEN_KEY)
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

export interface GalleryImage {
  id: string
  image_url: string
  thumbnail_url: string
  caption: string
  sort_order: number
  width: number
  height: number
  colors?: Array<{
    percentage: number
    hex: string
    hsv: { h: number; s: number; v: number }
  }>
  matched_color?: {
    hsv: { h: number; s: number; v: number }
    hex: string
    percentage: number
  }
  similarity_score?: number
  gallery_id?: string
}

export interface Gallery {
  id: string
  title: string
  description: string
  category: string
  tags: string[]
  cover_url: string
  source: string
  status: string
  image_count: number
  created_at: string
  updated_at: string
  images?: GalleryImage[]
}

export async function fetchSimilarByColor(params: {
  h: number
  s: number
  v: number
  limit?: number
  offset?: number
}): Promise<{ images: GalleryImage[]; total: number; has_more: boolean }> {
  const qs = new URLSearchParams()
  qs.set('h', String(params.h))
  qs.set('s', String(params.s))
  qs.set('v', String(params.v))
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))

  const resp = await fetch(`/api/galleries/colors/search?${qs}`, { headers: authHeaders() })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  return data.data
}

export async function fetchGalleries(params: {
  category?: string
  tag?: string
  limit?: number
  offset?: number
}): Promise<{ galleries: Gallery[]; total: number; has_more: boolean }> {
  const qs = new URLSearchParams()
  if (params.category) qs.set('category', params.category)
  if (params.tag) qs.set('tag', params.tag)
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))

  const resp = await fetch(`/api/galleries?${qs}`, { headers: authHeaders() })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  return data.data
}

export async function fetchGallery(id: string): Promise<Gallery> {
  const resp = await fetch(`/api/galleries/${id}`, { headers: authHeaders() })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  return data.data
}

export async function deleteGallery(id: string): Promise<void> {
  const resp = await fetch(`/api/galleries/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!resp.ok) {
    const data = await resp.json().catch(() => null)
    throw new Error(data?.error || `HTTP ${resp.status}`)
  }
}
