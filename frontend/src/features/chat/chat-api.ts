// Chat API client — SSE streaming + session CRUD

import { ApiError, handleUnauthorizedSession } from '@/lib/api'
import type { ChatArtifact, ChatSession, ChatSessionPreferences, ContentBlock, ImageResult, SearchSessionState, SSEEvent } from './chat-types'
import type { SearchPlanMessageRef } from './message-refs'

const authTokenStorageKey = 'fashion-report-access-token'

function getToken(): string | null {
  return window.localStorage.getItem(authTokenStorageKey)
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  }
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

function handle401(resp: Response) {
  if (resp.status === 401) {
    handleUnauthorizedSession()
  }
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
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ content, session_id: sessionId, history }),
      signal: options?.signal,
    })

    if (!resp.ok) {
      handle401(resp)
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
  const resp = await fetch(`/api/chat/sessions/${sessionId}/stop`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ run_id: runId ?? null }),
  })

  if (!resp.ok) {
    handle401(resp)
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
  limit = 20,
  tasteProfileId?: string | null,
  tasteProfileWeight?: number | null,
): Promise<{
  images: ImageResult[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}> {
  const resp = await fetch('/api/chat/search_session', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...searchReq,
      offset,
      limit,
      taste_profile_id: tasteProfileId ?? null,
      taste_profile_weight: tasteProfileWeight ?? null,
    }),
  })
  if (!resp.ok) {
    handle401(resp)
    throw new Error(`HTTP ${resp.status}`)
  }
  return resp.json()
}

export async function fetchSearchSessionById(
  searchRequestId: string,
  offset: number,
  limit = 20,
  tasteProfileId?: string | null,
  tasteProfileWeight?: number | null,
): Promise<{
  images: ImageResult[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}> {
  const resp = await fetch('/api/chat/search_session_by_id', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      search_request_id: searchRequestId,
      offset,
      limit,
      taste_profile_id: tasteProfileId ?? null,
      taste_profile_weight: tasteProfileWeight ?? null,
    }),
  })
  if (!resp.ok) {
    handle401(resp)
    throw new Error(`HTTP ${resp.status}`)
  }
  return resp.json()
}

export async function getChatArtifact(artifactId: string): Promise<ChatArtifact> {
  const resp = await fetch(`/api/chat/artifacts/${artifactId}`, {
    headers: authHeaders(),
  })
  if (!resp.ok) {
    handle401(resp)
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
  const resp = await fetch('/api/chat/resolve_search_plan_ref', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...target,
      current_session_id: currentSessionId ?? null,
    }),
  })
  if (!resp.ok) {
    handle401(resp)
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
  const resp = await fetch('/api/chat/sessions', {
    headers: authHeaders(),
  })
  if (!resp.ok) { handle401(resp); throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data ?? []
}

export async function createSession(title = '新对话', preferences?: ChatSessionPreferences | null): Promise<ChatSession> {
  const resp = await fetch('/api/chat/sessions', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      title,
      preferences: preferences ?? null,
    }),
  })
  if (!resp.ok) { handle401(resp); throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data
}

export async function updateSession(
  sessionId: string,
  patch: { title?: string; pinned?: boolean; preferences?: ChatSessionPreferences | null },
): Promise<ChatSession> {
  const resp = await fetch(`/api/chat/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(patch),
  })
  if (!resp.ok) { handle401(resp); throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data
}

export async function deleteSessionApi(sessionId: string): Promise<void> {
  const resp = await fetch(`/api/chat/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!resp.ok) { handle401(resp); throw new Error(`HTTP ${resp.status}`) }
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
  const resp = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
    headers: authHeaders(),
  })
  if (!resp.ok) { handle401(resp); throw new Error(`HTTP ${resp.status}`) }
  const data = await resp.json()
  return data.data ?? []
}

// ── Single image detail ──

export async function fetchImageDetail(imageId: string): Promise<ImageResult> {
  const resp = await fetch(`/api/chat/image/${imageId}`, {
    headers: authHeaders(),
  })
  if (!resp.ok) { handle401(resp); throw new Error(`HTTP ${resp.status}`) }
  return resp.json()
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
  const resp = await fetch('/api/chat/search_similar', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      brand: params.brand,
      categories: params.categories,
      garment_tags: params.garment_tags,
      image_id: params.image_id,
      top_category: params.top_category,
      gender: params.gender,
      quarter: params.quarter,
      page: params.page ?? 1,
      page_size: params.page_size ?? 56,
      taste_profile_id: params.taste_profile_id ?? null,
      taste_profile_weight: params.taste_profile_weight ?? null,
    }),
  })
  if (!resp.ok) { handle401(resp); throw new Error(`HTTP ${resp.status}`) }
  return resp.json()
}

export async function searchByColor(params: SearchByColorParams): Promise<SearchResponse> {
  const resp = await fetch('/api/chat/search_by_color', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      hex: params.hex,
      color_name: params.color_name ?? '',
      threshold: params.threshold ?? 75.0,
      gender: params.gender,
      quarter: params.quarter,
      page: params.page ?? 1,
      page_size: params.page_size ?? 56,
      taste_profile_id: params.taste_profile_id ?? null,
      taste_profile_weight: params.taste_profile_weight ?? null,
    }),
  })
  if (!resp.ok) { handle401(resp); throw new Error(`HTTP ${resp.status}`) }
  return resp.json()
}
