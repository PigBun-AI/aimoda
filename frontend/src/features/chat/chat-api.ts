// Chat API client — SSE streaming + session CRUD

import { ApiError, fetchWithAuth } from '@/lib/api'
import { registerDeletedCatalogImage } from '@/features/images/image-lifecycle'
import type {
  ChatArtifact,
  ChatPreferenceOptions,
  ChatSession,
  ChatSessionPreferences,
  ContentBlock,
  ImageResult,
  SearchSessionState,
  SSEEvent,
} from './chat-types'
import type { SearchPlanMessageRef } from './message-refs'

export const DEFAULT_DRAWER_PAGE_SIZE = 50
export const DEFAULT_IMAGE_SEARCH_PAGE_SIZE = 50

interface SearchSessionPageResponse {
  images: ImageResult[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

const searchSessionByIdCache = new Map<string, SearchSessionPageResponse>()
const searchSessionByIdInFlight = new Map<string, Promise<SearchSessionPageResponse>>()

function buildSearchSessionByIdCacheKey(
  searchRequestId: string,
  offset: number,
  limit: number,
  tasteProfileId?: string | null,
  tasteProfileWeight?: number | null,
): string {
  return JSON.stringify([
    searchRequestId,
    offset,
    limit,
    tasteProfileId ?? null,
    typeof tasteProfileWeight === 'number' ? Number(tasteProfileWeight.toFixed(4)) : null,
  ])
}

function removeImageFromCachedSearchSessions(imageId: string): string[] {
  const normalizedImageId = imageId.trim()
  if (!normalizedImageId) return []

  const affectedSearchRequestIds = new Set<string>()

  for (const [cacheKey, response] of searchSessionByIdCache.entries()) {
    const nextImages = (response.images ?? []).filter(image => image.image_id !== normalizedImageId)
    const removedCount = (response.images ?? []).length - nextImages.length
    if (removedCount <= 0) continue

    try {
      const [searchRequestId] = JSON.parse(cacheKey) as [string]
      if (typeof searchRequestId === 'string' && searchRequestId) {
        affectedSearchRequestIds.add(searchRequestId)
      }
    } catch {
      // Ignore malformed cache keys and still patch the cached payload.
    }

    searchSessionByIdCache.set(cacheKey, {
      ...response,
      images: nextImages,
      total: Math.max(0, response.total - removedCount),
      has_more: response.has_more,
    })
  }

  return Array.from(affectedSearchRequestIds)
}

export class ChatStreamAbortedError extends Error {
  constructor() {
    super('Chat stream aborted')
    this.name = 'ChatStreamAbortedError'
  }
}

/**
 * Send a chat message and stream SSE events
 */
export async function sendChatSSE(
  content: ContentBlock[],
  sessionId: string,
  history: Array<{ role: string; content: ContentBlock[] }>,
  onEvent: (event: SSEEvent) => void,
  onOpen?: (meta: { runId: string | null }) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  try {
    const resp = await fetchWithAuth('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ content, session_id: sessionId, history }),
      signal: options?.signal,
    })

    if (!resp.ok) {
      let payload: { error?: string; data?: unknown } | null = null
      try {
        payload = await resp.json() as { error?: string; data?: unknown }
      } catch {
        payload = null
      }
      throw new ApiError(
        payload?.error ?? `HTTP ${resp.status}: ${resp.statusText}`,
        resp.status,
        payload?.data,
      )
    }

    onOpen?.({
      runId: resp.headers.get('X-Aimoda-Run-Id'),
    })

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)))
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ChatStreamAbortedError()
    }
    throw error
  }
}

export async function stopChatRun(sessionId: string, runId?: string | null): Promise<boolean> {
  const resp = await fetchWithAuth(`/api/chat/sessions/${sessionId}/stop`, {
    method: 'POST',
    body: JSON.stringify({ run_id: runId ?? null }),
  })

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }

  const payload = await resp.json() as { data?: { stopped?: boolean } }
  return Boolean(payload.data?.stopped)
}

/**
 * Fetch paginated results for the image drawer
 */
export async function fetchSearchSession(
  searchReq: SearchSessionState,
  offset: number,
  limit = DEFAULT_DRAWER_PAGE_SIZE,
  tasteProfileId?: string | null,
  tasteProfileWeight?: number | null,
): Promise<SearchSessionPageResponse> {
  const resp = await fetchWithAuth('/api/chat/search_session', {
    method: 'POST',
    body: JSON.stringify({
      ...searchReq,
      offset,
      limit,
      ...(typeof tasteProfileId !== 'undefined' ? { taste_profile_id: tasteProfileId } : {}),
      ...(typeof tasteProfileWeight !== 'undefined' ? { taste_profile_weight: tasteProfileWeight } : {}),
    }),
  })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  return resp.json()
}

export async function fetchSearchSessionById(
  searchRequestId: string,
  offset: number,
  limit = DEFAULT_DRAWER_PAGE_SIZE,
  tasteProfileId?: string | null,
  tasteProfileWeight?: number | null,
): Promise<SearchSessionPageResponse> {
  const resp = await fetchWithAuth('/api/chat/search_session_by_id', {
    method: 'POST',
    body: JSON.stringify({
      search_request_id: searchRequestId,
      offset,
      limit,
      ...(typeof tasteProfileId !== 'undefined' ? { taste_profile_id: tasteProfileId } : {}),
      ...(typeof tasteProfileWeight !== 'undefined' ? { taste_profile_weight: tasteProfileWeight } : {}),
    }),
  })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  return resp.json()
}

export function peekCachedSearchSessionById(
  searchRequestId: string,
  offset: number,
  limit = DEFAULT_DRAWER_PAGE_SIZE,
  tasteProfileId?: string | null,
  tasteProfileWeight?: number | null,
): SearchSessionPageResponse | null {
  const cacheKey = buildSearchSessionByIdCacheKey(
    searchRequestId,
    offset,
    limit,
    tasteProfileId,
    tasteProfileWeight,
  )
  return searchSessionByIdCache.get(cacheKey) ?? null
}

export async function fetchCachedSearchSessionById(
  searchRequestId: string,
  offset: number,
  limit = DEFAULT_DRAWER_PAGE_SIZE,
  tasteProfileId?: string | null,
  tasteProfileWeight?: number | null,
): Promise<SearchSessionPageResponse> {
  const cacheKey = buildSearchSessionByIdCacheKey(
    searchRequestId,
    offset,
    limit,
    tasteProfileId,
    tasteProfileWeight,
  )
  const cached = searchSessionByIdCache.get(cacheKey)
  if (cached) return cached

  const inFlight = searchSessionByIdInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const request = fetchSearchSessionById(
    searchRequestId,
    offset,
    limit,
    tasteProfileId,
    tasteProfileWeight,
  )
    .then((response) => {
      searchSessionByIdCache.set(cacheKey, response)
      searchSessionByIdInFlight.delete(cacheKey)
      return response
    })
    .catch((error) => {
      searchSessionByIdInFlight.delete(cacheKey)
      throw error
    })

  searchSessionByIdInFlight.set(cacheKey, request)
  return request
}

export async function getChatArtifact(artifactId: string): Promise<ChatArtifact> {
  const resp = await fetchWithAuth(`/api/chat/artifacts/${artifactId}`)
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  const payload = await resp.json() as { data?: ChatArtifact }
  if (!payload.data) {
    throw new Error('Artifact payload missing')
  }
  return payload.data
}

export async function resolveSearchPlanRef(
  target: SearchPlanMessageRef,
  currentSessionId?: string | null,
): Promise<{
  search_request_id: string
  total: number
  label?: string
  filters_applied?: string[]
}> {
  const resp = await fetchWithAuth('/api/chat/resolve_search_plan_ref', {
    method: 'POST',
    body: JSON.stringify({
      ...target,
      current_session_id: currentSessionId ?? null,
    }),
  })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  const payload = await resp.json() as {
    data?: {
      search_request_id: string
      total: number
      label?: string
      filters_applied?: string[]
    }
  }
  if (!payload.data?.search_request_id) {
    throw new Error('Search plan resolve payload missing')
  }
  return payload.data
}

// ── Session CRUD ──

export async function listSessions(): Promise<ChatSession[]> {
  const resp = await fetchWithAuth('/api/chat/sessions')
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data ?? []
}

export async function getChatPreferenceOptions(): Promise<ChatPreferenceOptions> {
  const resp = await fetchWithAuth('/api/chat/preferences/options')
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data
}

export async function createSession(title = '新对话', preferences?: ChatSessionPreferences | null): Promise<ChatSession> {
  const resp = await fetchWithAuth('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({
      title,
      preferences: preferences ?? null,
    }),
  })
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data
}

export async function updateSession(
  sessionId: string,
  patch: { title?: string; pinned?: boolean; preferences?: ChatSessionPreferences | null },
): Promise<ChatSession> {
  const resp = await fetchWithAuth(`/api/chat/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data
}

export async function deleteSessionApi(sessionId: string): Promise<void> {
  const resp = await fetchWithAuth(`/api/chat/sessions/${sessionId}`, {
    method: 'DELETE',
  })
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
}

/**
 * Fetch messages for a given session
 */
export async function getSessionMessages(sessionId: string): Promise<Array<{
  id: string
  role: string
  content: ContentBlock[] | string
  metadata?: Record<string, unknown>
}>> {
  const resp = await fetchWithAuth(`/api/chat/sessions/${sessionId}/messages`)
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data ?? []
}

// ── Single image detail ──

export async function fetchImageDetail(imageId: string): Promise<ImageResult> {
  const resp = await fetchWithAuth(`/api/chat/image/${imageId}`)
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
  return resp.json()
}

export async function deleteCatalogImage(imageId: string): Promise<{
  image_id: string
  image_url?: string
  brand?: string
  removed_collection_count?: number
  affected_collection_ids?: string[]
}> {
  const resp = await fetchWithAuth(`/api/chat/image/${imageId}`, {
    method: 'DELETE',
  })
  if (!resp.ok) {
    let payload: { detail?: string; error?: string } | null = null
    try {
      payload = await resp.json() as { detail?: string; error?: string }
    } catch {
      payload = null
    }
    throw new ApiError(
      payload?.detail ?? payload?.error ?? `HTTP ${resp.status}: ${resp.statusText}`,
      resp.status,
      payload,
    )
  }

  const payload = await resp.json() as {
    data?: {
      image_id: string
      image_url?: string
      brand?: string
      removed_collection_count?: number
      affected_collection_ids?: string[]
    }
  }

  if (!payload.data?.image_id) {
    throw new Error('Delete image payload missing')
  }

  const affectedSearchRequestIds = removeImageFromCachedSearchSessions(payload.data.image_id)
  registerDeletedCatalogImage({
    imageId: payload.data.image_id,
    imageUrl: payload.data.image_url,
    brand: payload.data.brand,
    affectedSearchRequestIds,
    affectedFavoriteCollectionIds: payload.data.affected_collection_ids ?? [],
    removedCollectionCount: payload.data.removed_collection_count,
  })

  return payload.data
}


// ── Image detail inline search ──

export interface SearchSimilarParams {
  brand?: string
  categories?: string[]
  garment_tags?: string[]
  image_id?: string
  top_category?: string
  gender?: string
  quarter?: string
  page?: number
  page_size?: number
  taste_profile_id?: string | null
  taste_profile_weight?: number | null
}

export interface SearchByColorParams {
  hex: string
  color_name?: string
  threshold?: number
  gender?: string
  quarter?: string
  page?: number
  page_size?: number
  taste_profile_id?: string | null
  taste_profile_weight?: number | null
}

export interface SearchResponse {
  images: ImageResult[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

export async function searchSimilar(params: SearchSimilarParams): Promise<SearchResponse> {
  const resp = await fetchWithAuth('/api/chat/search_similar', {
    method: 'POST',
    body: JSON.stringify({
      brand: params.brand,
      categories: params.categories,
      garment_tags: params.garment_tags,
      image_id: params.image_id,
      top_category: params.top_category,
      gender: params.gender,
      quarter: params.quarter,
      page: params.page ?? 1,
      page_size: params.page_size ?? DEFAULT_IMAGE_SEARCH_PAGE_SIZE,
      ...(typeof params.taste_profile_id !== 'undefined' ? { taste_profile_id: params.taste_profile_id } : {}),
      ...(typeof params.taste_profile_weight !== 'undefined' ? { taste_profile_weight: params.taste_profile_weight } : {}),
    }),
  })
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
  return resp.json()
}

export async function searchByColor(params: SearchByColorParams): Promise<SearchResponse> {
  const resp = await fetchWithAuth('/api/chat/search_by_color', {
    method: 'POST',
    body: JSON.stringify({
      hex: params.hex,
      color_name: params.color_name ?? '',
      threshold: params.threshold ?? 75.0,
      gender: params.gender,
      quarter: params.quarter,
      page: params.page ?? 1,
      page_size: params.page_size ?? DEFAULT_IMAGE_SEARCH_PAGE_SIZE,
      ...(typeof params.taste_profile_id !== 'undefined' ? { taste_profile_id: params.taste_profile_id } : {}),
      ...(typeof params.taste_profile_weight !== 'undefined' ? { taste_profile_weight: params.taste_profile_weight } : {}),
    }),
  })
  if (!resp.ok) { throw new Error(`HTTP ${resp.status}`) }
  return resp.json()
}
