// Chat API client — SSE streaming + session CRUD

import type { ChatSession, ContentBlock, ImageResult, SearchSessionState, SSEEvent } from './chat-types'

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

/**
 * Send a chat message and stream SSE events
 */
export async function sendChatSSE(
  message: string,
  sessionId: string,
  history: Array<{ role: string; content: ContentBlock[] }>,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message, session_id: sessionId, history }),
  })

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
  }

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
}

/**
 * Fetch paginated results for the image drawer
 */
export async function fetchSearchSession(
  searchReq: SearchSessionState,
  offset: number,
  limit = 20,
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
    body: JSON.stringify({ ...searchReq, offset, limit }),
  })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  return resp.json()
}

// ── Session CRUD ──

export async function listSessions(): Promise<ChatSession[]> {
  const resp = await fetch('/api/chat/sessions', {
    headers: authHeaders(),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  return data.data ?? []
}

export async function createSession(title = '新对话'): Promise<ChatSession> {
  const resp = await fetch('/api/chat/sessions', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title }),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  return data.data
}

export async function updateSession(
  sessionId: string,
  patch: { title?: string; pinned?: boolean },
): Promise<ChatSession> {
  const resp = await fetch(`/api/chat/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(patch),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  return data.data
}

export async function deleteSessionApi(sessionId: string): Promise<void> {
  const resp = await fetch(`/api/chat/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
}

/**
 * Fetch messages for a given session
 * TODO: Wire up backend GET /api/chat/sessions/{sessionId}/messages
 */
export async function getSessionMessages(sessionId: string): Promise<Array<{ id: string; role: string; content: ContentBlock[] | string }>> {
  const resp = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
    headers: authHeaders(),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  return data.data ?? []
}
