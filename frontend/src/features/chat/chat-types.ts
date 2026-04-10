// Chat feature type definitions
export type { MessageAnnotation, MessageRefTarget } from './message-refs'
import type { MessageAnnotation } from './message-refs'

export interface ChatSession {
  id: string
  user_id: number
  title: string
  status?: string
  is_pinned?: boolean
  pinned_at?: string | null
  title_source?: 'default' | 'heuristic' | 'ai' | 'manual' | string
  title_locked?: boolean
  execution_status?: 'idle' | 'running' | 'stopping' | 'completed' | 'error'
  current_run_id?: string | null
  last_run_id?: string | null
  last_run_started_at?: string | null
  last_run_completed_at?: string | null
  last_run_error?: string | null
  message_count?: number
  thread_version?: number
  active_summary_version?: number
  preferences?: ChatSessionPreferences
  created_at: string
  updated_at: string
}

export interface ChatSessionPreferences {
  gender?: 'female' | 'male' | null
  quarter?: '早春' | '春夏' | '早秋' | '秋冬' | null
  year?: number | null
  taste_profile_id?: string | null
  taste_profile_weight?: number | null
}

export interface ImageSourceBase64 {
  type: 'base64'
  media_type: string
  data: string
}

export interface ImageSourceUrl {
  type: 'url'
  url: string
}

export type ImageSource = ImageSourceBase64 | ImageSourceUrl

export interface DocumentSourceFile {
  type: 'file'
  file_id: string
}

export interface DocumentSourceUrl {
  type: 'url'
  url: string
}

export type DocumentSource = DocumentSourceFile | DocumentSourceUrl

// ContentBlock — Claude Code style inline blocks
export type ContentBlock =
  | { type: 'text'; text: string; annotations?: MessageAnnotation[] }
  | { type: 'reasoning'; text: string }
  | { type: 'image'; source: ImageSource; mime_type?: string; file_name?: string; alt_text?: string }
  | { type: 'document'; source: DocumentSource; mime_type?: string; file_name?: string; title?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; status?: 'running' | 'done' }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; images?: ImageResult[]; metadata?: Record<string, unknown> }

/** Parsed data from show_collection tool result */
export interface SearchResultData {
  action: 'show_collection'
  total: number
  filters_applied: string[]
  message: string
  search_request_id: string
  query?: string
}

export interface BundleResultGroup {
  group_id: string
  label: string
  search_request_id: string
  query?: string
  filters_applied?: string[]
  total?: number
}

export interface ChatArtifact {
  id: string
  artifact_type: string
  session_id: string
  metadata: Record<string, unknown>
  content?: string | null
}

export interface FashionVisionAnalysis {
  summary_zh: string
  retrieval_query_en: string
  style_keywords: string[]
  hard_filters: {
    category: string[]
    color: string[]
    fabric: string[]
    gender: string
    quarter: string[]
  }
  follow_up_questions_zh: string[]
}

export interface FashionVisionResultData {
  ok: boolean
  artifact_id?: string | null
  image_count?: number
  model?: string
  analysis: FashionVisionAnalysis
}

export interface StyleKnowledgePrimaryStyle {
  style_name: string
  aliases?: string[]
  category?: string
  confidence?: number
  match_type?: string
  score?: number
}

export interface StyleKnowledgeFeatures {
  visual_description_en?: string
  palette: string[]
  silhouette: string[]
  fabric: string[]
  details: string[]
  reference_brands: string[]
  season_relevance: string[]
  gender?: string
}

export interface StyleKnowledgeRetrievalPlan {
  retrieval_query_en?: string
  semantic_boost_terms?: string[]
  suggested_filters?: Record<string, string[] | string>
  soft_constraints?: Record<string, string[] | string>
}

export interface StyleKnowledgeResultData {
  status: 'ok' | 'not_found' | 'invalid_query' | 'error'
  query: string
  message?: string
  search_stage?: string
  match_confidence?: 'confirmed' | 'candidate' | 'fallback' | string
  requires_agent_validation?: boolean
  agent_hint?: string
  rich_text?: string
  rich_text_summary?: string
  primary_style?: StyleKnowledgePrimaryStyle
  alternatives?: StyleKnowledgePrimaryStyle[]
  style_features?: StyleKnowledgeFeatures
  retrieval_plan?: StyleKnowledgeRetrievalPlan
  fallback_suggestion?: string | null
  error?: string
}

// ChatMessage — updated to use ContentBlock[]
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: ContentBlock[]  // replaces string + steps approach
  metadata?: Record<string, unknown>
}

// SSE event types — upgraded to two-layer block streaming format
export type SSEEvent =
  | { type: 'content_block_start'; index: number; block_type: 'text' }
  | { type: 'content_block_start'; index: number; block_type: 'reasoning' }
  | { type: 'content_block_start'; index: number; block_type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'content_block_start'; index: number; block_type: 'tool_result'; tool_use_id: string; content?: string; images?: unknown[]; metadata?: Record<string, unknown> }
  | { type: 'content_block_delta'; index: number; delta: string | Record<string, unknown> }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_stop'; stop_reason: string }
  | { type: 'message_finalized'; content: ContentBlock[] }
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
  searchRequestId?: string | null
}

import type { ObjectArea } from './crop-utils'

export interface GarmentColor {
  name: string
  hex: string
  percentage: number
}

export interface GarmentDetail {
  name: string
  category: string
  top_category: string // 'tops' | 'bottoms' | 'full' | 'footwear' | 'bags' | 'accessories'
  pattern: string
  fabric: string
  silhouette: string
  sleeve_length: string
  garment_length: string
  collar: string
  bbox: [number, number, number, number] | null // [x1, y1, x2, y2] normalized 0-1
  colors: GarmentColor[]
}

export interface ExtractedColor {
  hex: string
  color_name: string
  percentage: number
  type: string // 'dominant' | 'secondary' | 'accent'
  area: string
}

export interface ImageResult {
  image_url: string
  image_id: string
  brand: string
  year?: number | string | null
  quarter?: string | null
  season?: string | null
  gender?: string
  score: number
  garments: GarmentDetail[]
  extracted_colors: ExtractedColor[]
  colors: string[]
  style: string
  object_area?: ObjectArea | null
  is_favorited?: boolean
  favorite_collection_ids?: string[]
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
  searchRequestId: string | null
  tasteProfileId?: string | null
  tasteProfileWeight?: number | null
  offset: number
  hasMore: boolean
  total?: number
  isLoadingMore: boolean
  emptyState?: 'none' | 'empty' | 'unavailable'
}

export interface ChatComposerInput {
  content: ContentBlock[]
}
