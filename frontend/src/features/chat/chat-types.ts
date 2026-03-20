// Chat feature type definitions

export interface ChatSession {
  id: string
  user_id: number
  title: string
  status?: string
  is_pinned?: boolean
  pinned_at?: string | null
  execution_status?: 'idle' | 'running' | 'completed' | 'error'
  last_run_started_at?: string | null
  last_run_completed_at?: string | null
  last_run_error?: string | null
  created_at: string
  updated_at: string
}

// ContentBlock — Claude Code style inline blocks
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; status?: 'running' | 'done' }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; images?: ImageResult[]; metadata?: Record<string, unknown> }

/** Parsed data from show_collection tool result */
export interface SearchResultData {
  action: 'show_collection'
  search_request: SearchSessionState
  total: number
  filters_applied: string[]
  message: string
}

// ChatMessage — updated to use ContentBlock[]
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: ContentBlock[]  // replaces string + steps approach
}

// SSE event types — upgraded to two-layer block streaming format
export type SSEEvent =
  | { type: 'content_block_start'; index: number; block_type: 'text' }
  | { type: 'content_block_start'; index: number; block_type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'content_block_start'; index: number; block_type: 'tool_result'; tool_use_id: string; content?: string; images?: unknown[]; metadata?: Record<string, unknown> }
  | { type: 'content_block_delta'; index: number; delta: string | Record<string, unknown> }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_stop'; stop_reason: string }
  | { type: 'error'; message: string }

/** @deprecated use ContentBlock instead */
export interface ToolStep {
  type: 'call' | 'result'
  toolName: string
  args?: Record<string, unknown>
  step: number
  callId: string
  resultCount?: number
  matchLevel?: string
  images?: ImageResult[]
  searchRequest?: SearchSessionState | null
}

import type { ObjectArea } from './crop-utils'

export interface ImageResult {
  image_url: string
  image_id: string
  brand: string
  year?: number | string | null
  quarter?: string | null
  season?: string | null
  score: number
  garments: unknown[]
  colors: unknown[]
  style: string
  object_area?: ObjectArea | null
}

export interface SearchSessionState {
  query: string
  vector_type: string
  q_emb: number[] | null
  filters: Array<{type: string; key: string; value: string}>
  active: boolean
}

export interface DrawerData {
  stepLabel: string
  images: ImageResult[]
  searchRequest: SearchSessionState | null
  offset: number
  hasMore: boolean
  total?: number
  isLoadingMore: boolean
}
