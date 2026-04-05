// Chat hooks — SSE streaming state management

import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatMessage, ContentBlock, ToolStep, DrawerData, ImageResult, ChatSession, ChatComposerInput } from './chat-types'
import { sendChatSSE, fetchSearchSessionById, listSessions, createSession, deleteSessionApi, getSessionMessages } from './chat-api'
import { useSessionStore } from './session-store'
import { deriveSessionTitleFromBlocks } from './session-title'
import { normalizeContentBlocks } from './content-blocks'
import {
  appendOptimisticExchange,
  applyHydratedMessages,
  finishSessionStream,
  replaceAssistantMessage,
  requestSessionHydration,
  useChatMessageStore,
} from './chat-message-store'

function toolResultLooksLikeError(content: string): boolean {
  try {
    const data = JSON.parse(content)
    return typeof data?.error === 'string' && data.error.length > 0
  } catch {
    return false
  }
}

/**
 * Main chat hook — manages messages, SSE streaming, and drawer state
 */
export function useChat(sessionId: string | null) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerData, setDrawerData] = useState<DrawerData | null>(null)
  const { messages, isLoading } = useChatMessageStore(sessionId)

  const { sessions, markSessionExecutionStatus, primeSessionForImmediateRun, syncSessionRunId, loadSessions } = useSessionStore()
  const activeSession = sessionId ? sessions.find(session => session.id === sessionId) ?? null : null
  const isRemoteRunning = activeSession?.execution_status === 'running'
  const wasRemoteRunningRef = useRef(false)

  useEffect(() => {
    setDrawerOpen(false)
    setDrawerData(null)
  }, [sessionId])

  const hydrateSessionMessages = useCallback((targetSessionId: string) => {
    const { requestId, baseRevision } = requestSessionHydration(targetSessionId)

    getSessionMessages(targetSessionId)
      .then(msgs => {
        // Map backend messages to frontend ChatMessage format with ContentBlock[]
        const mapped: ChatMessage[] = msgs.map(m => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          // Backward compatibility: content can be string (old) or ContentBlock[] (new)
          content: normalizeContentBlocks(
            Array.isArray(m.content)
              ? m.content
              : typeof m.content === 'string' && m.content
                ? [{ type: 'text' as const, text: m.content }]
                : [],
          ),
        }))
        applyHydratedMessages(targetSessionId, requestId, baseRevision, mapped)
      })
      .catch(err => console.error('Failed to load session messages', err))
  }, [])

  // Load historical messages when switching sessions
  useEffect(() => {
    if (!sessionId) {
      return
    }

    hydrateSessionMessages(sessionId)
  }, [hydrateSessionMessages, sessionId])

  // When a running session is reopened after refresh, poll persisted drafts until it finishes.
  useEffect(() => {
    if (!sessionId || isLoading) return

    if (!isRemoteRunning) {
      if (wasRemoteRunningRef.current) {
        wasRemoteRunningRef.current = false
        hydrateSessionMessages(sessionId)
      }
      return
    }

    wasRemoteRunningRef.current = true
    hydrateSessionMessages(sessionId)

    const intervalId = window.setInterval(() => {
      hydrateSessionMessages(sessionId)
    }, 2000)

    return () => window.clearInterval(intervalId)
  }, [hydrateSessionMessages, isLoading, isRemoteRunning, sessionId])

  const sendMessage = useCallback(async (input: ChatComposerInput, overrideSessionId?: string) => {
    const sid = overrideSessionId || sessionId
    const content = input.content.filter(block => {
      if (block.type === 'text') return Boolean(block.text.trim())
      return true
    })
    if (content.length === 0 || !sid || isLoading) return

    const optimisticRunId = `pending-${sid}-${Date.now()}`
    primeSessionForImmediateRun(sid, {
      title: deriveSessionTitleFromBlocks(content),
      runId: optimisticRunId,
    })
    markSessionExecutionStatus(sid, 'running', null, optimisticRunId)

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
    }

    // Build history for API — include the user message we just added
    const history = [...messages, userMsg]
      .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content.length > 0))
      .map(m => ({ role: m.role, content: m.content }))

    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: [],
    }
    appendOptimisticExchange(sid, userMsg, assistantMsg)
    let activeRunId = optimisticRunId

    // SSE block streaming state
    const blockMap = new Map<number, ContentBlock>()
    let streamFailedMessage: string | null = null
    const getOrderedBlocks = () => Array.from(blockMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, block]) => block)

    const commitAssistantBlocks = () => {
      const orderedBlocks = normalizeContentBlocks(getOrderedBlocks())
      replaceAssistantMessage(sid, assistantMsg.id, orderedBlocks)
    }

    const ensureBlock = (index: number, fallbackType: 'text' | 'reasoning' | 'tool_use' | 'tool_result' = 'text'): ContentBlock => {
      const existing = blockMap.get(index)
      if (existing) return existing

      const next: ContentBlock =
        fallbackType === 'reasoning'
          ? { type: 'reasoning', text: '' }
          : fallbackType === 'tool_use'
          ? { type: 'tool_use', id: `tool-${Date.now()}-${index}`, name: '', input: {} }
          : fallbackType === 'tool_result'
            ? { type: 'tool_result', tool_use_id: '', content: '' }
            : { type: 'text', text: '' }

      blockMap.set(index, next)
      return next
    }

    try {
      await sendChatSSE(content, sid, history, (event) => {
        if (event.type === 'content_block_start') {
          const eventWithPayload = event as typeof event & Record<string, unknown>
          const blockType = event.block_type
          if (blockType === 'text') {
            ensureBlock(event.index, 'text')
          } else if (blockType === 'reasoning') {
            ensureBlock(event.index, 'reasoning')
          } else if (blockType === 'tool_use') {
            const id = typeof eventWithPayload.id === 'string' ? eventWithPayload.id : `tool-${Date.now()}-${event.index}`
            const name = typeof eventWithPayload.name === 'string' ? eventWithPayload.name : ''
            const input = typeof eventWithPayload.input === 'object' && eventWithPayload.input !== null
              ? eventWithPayload.input as Record<string, unknown>
              : {}
            blockMap.set(event.index, { type: 'tool_use', id, name, input: { ...input } })
          } else if (blockType === 'tool_result') {
            const toolUseId = typeof eventWithPayload.tool_use_id === 'string' ? eventWithPayload.tool_use_id : ''
            const images = Array.isArray(eventWithPayload.images) ? eventWithPayload.images as ImageResult[] : undefined
            const metadata = typeof eventWithPayload.metadata === 'object' && eventWithPayload.metadata !== null
              ? eventWithPayload.metadata as Record<string, unknown>
              : undefined
            blockMap.set(event.index, { type: 'tool_result', tool_use_id: toolUseId, content: '', images, metadata })
          }
          commitAssistantBlocks()
        } else if (event.type === 'content_block_delta') {
          const block = ensureBlock(event.index)
          if (!block) return
          if (block.type === 'text') {
            block.text += typeof event.delta === 'string' ? event.delta : ''
          } else if (block.type === 'reasoning') {
            block.text += typeof event.delta === 'string' ? event.delta : ''
          } else if (block.type === 'tool_use') {
            if (typeof event.delta === 'object' && event.delta !== null) {
              const deltaObj = event.delta as Record<string, unknown>
              const inputDelta = typeof deltaObj.input === 'object' && deltaObj.input !== null
                ? deltaObj.input as Record<string, unknown>
                : deltaObj
              Object.assign(block.input, inputDelta)
            }
          } else if (block.type === 'tool_result') {
            if (typeof event.delta === 'string') {
              block.content += event.delta
            } else if (typeof event.delta === 'object' && event.delta !== null) {
              const content = (event.delta as Record<string, unknown>).content
              if (typeof content === 'string') {
                block.content += content
              }
            }
          }
          commitAssistantBlocks()
        } else if (event.type === 'content_block_stop') {
          const block = blockMap.get(event.index)
          if (block && block.type === 'tool_use') {
            ;(block as { status?: string }).status = 'done'
            commitAssistantBlocks()
          } else if (block && block.type === 'tool_result') {
            block.is_error = toolResultLooksLikeError(block.content)
            commitAssistantBlocks()
          }
        } else if (event.type === 'message_stop') {
          // entire message done — update with accumulated blocks
          commitAssistantBlocks()
        } else if (event.type === 'error') {
          streamFailedMessage = event.message
          replaceAssistantMessage(sid, assistantMsg.id, [{ type: 'text', text: `Error: ${event.message}` }])
        }
      }, (meta) => {
        if (!meta.runId) return
        activeRunId = meta.runId
        syncSessionRunId(sid, meta.runId)
      })
      markSessionExecutionStatus(sid, streamFailedMessage ? 'error' : 'completed', streamFailedMessage, activeRunId)
    } catch (err) {
      markSessionExecutionStatus(sid, 'error', err instanceof Error ? err.message : String(err), activeRunId)
      replaceAssistantMessage(sid, assistantMsg.id, [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }])
    } finally {
      finishSessionStream(sid)
      void loadSessions()
    }
  }, [isLoading, loadSessions, markSessionExecutionStatus, messages, primeSessionForImmediateRun, sessionId, syncSessionRunId])

  const openDrawer = useCallback(async (step: ToolStep) => {
    const searchRequestId = step.searchRequestId
    const hasImages = step.images && step.images.length > 0

    if (searchRequestId) {
      setDrawerData({
        stepLabel: step.toolName,
        images: [],
        searchRequestId,
        offset: 0,
        hasMore: true,
        isLoadingMore: true,
      })
      setDrawerOpen(true)

      try {
        const data = await fetchSearchSessionById(searchRequestId, 0)
        setDrawerData(prev => prev ? {
          ...prev,
          images: data.images || [],
          offset: data.offset + data.limit,
          hasMore: data.has_more,
          total: data.total,
          isLoadingMore: false,
        } : null)
      } catch (e) {
        console.error('load search session error', e)
      }
    } else if (hasImages) {
      setDrawerData({
        stepLabel: step.toolName,
        images: step.images!,
        searchRequestId: null,
        offset: 0,
        hasMore: false,
        isLoadingMore: false,
      })
      setDrawerOpen(true)
    }
  }, [])

  /** Open drawer directly from a search_request_id (used by SearchResultCard) */
  const openDrawerFromSearchRequestId = useCallback(async (searchRequestId: string) => {
    setDrawerData({
      stepLabel: 'show_collection',
      images: [],
      searchRequestId,
      offset: 0,
      hasMore: true,
      isLoadingMore: true,
    })
    setDrawerOpen(true)

    try {
      const data = await fetchSearchSessionById(searchRequestId, 0)
      setDrawerData(prev => prev ? {
        ...prev,
        images: data.images || [],
        offset: data.offset + data.limit,
        hasMore: data.has_more,
        total: data.total,
        isLoadingMore: false,
      } : null)
    } catch (e) {
      console.error('load search session error', e)
    }
  }, [])

  const loadMoreDrawerImages = useCallback(async () => {
    if (!drawerData?.searchRequestId || !drawerData.hasMore) return

    setDrawerData(prev => prev ? { ...prev, isLoadingMore: true } : null)
    try {
      const data = await fetchSearchSessionById(drawerData.searchRequestId, drawerData.offset)
      setDrawerData(prev => prev ? {
        ...prev,
        images: [...prev.images, ...(data.images || [])],
        offset: data.offset + data.limit,
        hasMore: data.has_more,
        isLoadingMore: false,
      } : null)
    } catch (e) {
      console.error(e)
    }
  }, [drawerData])

  return {
    messages,
    isLoading,
    sendMessage,
    drawerOpen,
    setDrawerOpen,
    drawerData,
    openDrawer,
    openDrawerFromSearchRequestId,
    loadMoreDrawerImages,
  }
}

/**
 * Session management hook
 */
export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadSessions = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listSessions()
      setSessions(data)
      // Auto-select most recent if none selected (use functional update to avoid dependency)
      setActiveSessionId(prev => {
        if (!prev && data.length > 0) return data[0].id
        return prev
      })
    } catch (e) {
      console.error('Failed to load sessions', e)
    }
    setIsLoading(false)
  }, [])

  const newSession = useCallback(async () => {
    try {
      const session = await createSession()
      setSessions(prev => [session, ...prev])
      setActiveSessionId(session.id)
      return session
    } catch (e) {
      console.error('Failed to create session', e)
      return null
    }
  }, [])

  const removeSession = useCallback(async (id: string) => {
    try {
      await deleteSessionApi(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (activeSessionId === id) {
        setActiveSessionId(sessions.find(s => s.id !== id)?.id ?? null)
      }
    } catch (e) {
      console.error('Failed to delete session', e)
    }
  }, [activeSessionId, sessions])

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    isLoading,
    loadSessions,
    newSession,
    removeSession,
  }
}
