// Chat hooks — SSE streaming state management

import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatMessage, ContentBlock, ToolStep, DrawerData, ImageResult, ChatSession, ChatComposerInput } from './chat-types'
import { ChatStreamAbortedError, sendChatSSE, fetchSearchSessionById, listSessions, createSession, deleteSessionApi, getSessionMessages, stopChatRun } from './chat-api'
import { useSessionStore } from './session-store'
import { deriveSessionTitleFromBlocks } from './session-title'
import { normalizeContentBlocks } from './content-blocks'
import {
  appendOptimisticExchange,
  applyHydratedMessages,
  finishSessionStream,
  removeMessage,
  replaceAssistantMessage,
  requestSessionHydration,
  useChatMessageStore,
} from './chat-message-store'

const TERMINAL_REF_ENRICHMENT_STATES = new Set(['completed', 'skipped', 'error', 'timeout'])

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
export function useChat(
  sessionId: string | null,
  defaultTasteProfileId: string | null = null,
  defaultTasteProfileWeight: number | null = 0.24,
) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerData, setDrawerData] = useState<DrawerData | null>(null)
  const { messages, isLoading } = useChatMessageStore(sessionId)

  const { sessions, markSessionExecutionStatus, primeSessionForImmediateRun, syncSessionRunId, loadSessions } = useSessionStore()
  const activeSession = sessionId ? sessions.find(session => session.id === sessionId) ?? null : null
  const isRemoteRunning = activeSession?.execution_status === 'running' || activeSession?.execution_status === 'stopping'
  const wasRemoteRunningRef = useRef(false)
  const activeAbortControllerRef = useRef<AbortController | null>(null)
  const activeRunIdRef = useRef<string | null>(activeSession?.current_run_id ?? null)
  const stopRequestedRef = useRef(false)
  const postRunHydrationTokenRef = useRef(0)
  const [isStopping, setIsStopping] = useState(false)

  useEffect(() => {
    setDrawerOpen(false)
    setDrawerData(null)
    postRunHydrationTokenRef.current += 1
  }, [sessionId])

  const hydrateSessionMessages = useCallback(async (targetSessionId: string): Promise<ChatMessage[]> => {
    const { requestId, baseRevision } = requestSessionHydration(targetSessionId)

    try {
      const msgs = await getSessionMessages(targetSessionId)
      const mapped: ChatMessage[] = msgs.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: normalizeContentBlocks(
          Array.isArray(m.content)
            ? m.content
            : typeof m.content === 'string' && m.content
              ? [{ type: 'text' as const, text: m.content }]
              : [],
        ),
        metadata: typeof m.metadata === 'object' && m.metadata !== null
          ? m.metadata as Record<string, unknown>
          : undefined,
      }))
      applyHydratedMessages(targetSessionId, requestId, baseRevision, mapped)
      return mapped
    } catch (err) {
      console.error('Failed to load session messages', err)
      throw err
    }
  }, [])

  const schedulePostRunHydration = useCallback((targetSessionId: string) => {
    const token = Date.now()
    postRunHydrationTokenRef.current = token

    const run = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (postRunHydrationTokenRef.current !== token) return

        try {
          const mapped = await hydrateSessionMessages(targetSessionId)
          const latestAssistant = [...mapped].reverse().find(message => message.role === 'assistant')
          const enrichmentStatus = typeof latestAssistant?.metadata?.ref_enrichment_status === 'string'
            ? latestAssistant.metadata.ref_enrichment_status
            : null
          const hasInlineRefs = latestAssistant?.content.some(
            block => block.type === 'text' && Array.isArray(block.annotations) && block.annotations.some(annotation => annotation?.type === 'message_ref_spans'),
          )

          if (hasInlineRefs || (enrichmentStatus && TERMINAL_REF_ENRICHMENT_STATES.has(enrichmentStatus))) {
            break
          }
        } catch {
          // Keep the short poll alive; a later attempt may succeed once the post-run write lands.
        }

        await loadSessions()
        await new Promise(resolve => window.setTimeout(resolve, 1200))
      }
    }

    void run()
  }, [hydrateSessionMessages, loadSessions])

  // Load historical messages when switching sessions
  useEffect(() => {
    if (!sessionId) {
      return
    }

    void hydrateSessionMessages(sessionId)
  }, [hydrateSessionMessages, sessionId])

  useEffect(() => {
    activeRunIdRef.current = activeSession?.current_run_id ?? null
  }, [activeSession?.current_run_id])

  // When a running session is reopened after refresh, poll persisted drafts until it finishes.
  useEffect(() => {
    if (!sessionId || isLoading) return

    if (!isRemoteRunning) {
      if (wasRemoteRunningRef.current) {
        wasRemoteRunningRef.current = false
        void hydrateSessionMessages(sessionId)
      }
      return
    }

    wasRemoteRunningRef.current = true
    void hydrateSessionMessages(sessionId)

    const intervalId = window.setInterval(() => {
      void hydrateSessionMessages(sessionId)
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
    const abortController = new AbortController()
    activeAbortControllerRef.current = abortController
    activeRunIdRef.current = optimisticRunId
    stopRequestedRef.current = false
    setIsStopping(false)

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
          finishSessionStream(sid)
          markSessionExecutionStatus(sid, streamFailedMessage ? 'error' : 'completed', streamFailedMessage, activeRunId)
          schedulePostRunHydration(sid)
        } else if (event.type === 'message_finalized') {
          replaceAssistantMessage(
            sid,
            assistantMsg.id,
            normalizeContentBlocks(Array.isArray(event.content) ? event.content : []),
          )
        } else if (event.type === 'error') {
          streamFailedMessage = event.message
          replaceAssistantMessage(sid, assistantMsg.id, [{ type: 'text', text: `Error: ${event.message}` }])
        }
      }, (meta) => {
        if (!meta.runId) return
        activeRunId = meta.runId
        activeRunIdRef.current = meta.runId
        syncSessionRunId(sid, meta.runId)
      }, { signal: abortController.signal })
      markSessionExecutionStatus(sid, streamFailedMessage ? 'error' : 'completed', streamFailedMessage, activeRunId)
    } catch (err) {
      if (err instanceof ChatStreamAbortedError && stopRequestedRef.current) {
        const hasPartialBlocks = getOrderedBlocks().length > 0
        if (hasPartialBlocks) {
          commitAssistantBlocks()
        } else {
          removeMessage(sid, assistantMsg.id)
        }
        markSessionExecutionStatus(sid, hasPartialBlocks ? 'completed' : 'idle', null, activeRunId)
        return
      }
      markSessionExecutionStatus(sid, 'error', err instanceof Error ? err.message : String(err), activeRunId)
      replaceAssistantMessage(sid, assistantMsg.id, [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }])
    } finally {
      activeAbortControllerRef.current = null
      activeRunIdRef.current = null
      stopRequestedRef.current = false
      setIsStopping(false)
      finishSessionStream(sid)
      void loadSessions()
    }
  }, [isLoading, loadSessions, markSessionExecutionStatus, messages, primeSessionForImmediateRun, sessionId, syncSessionRunId])

  const stopMessage = useCallback(async () => {
    if (!sessionId || !activeAbortControllerRef.current || isStopping) return

    stopRequestedRef.current = true
    setIsStopping(true)
    markSessionExecutionStatus(sessionId, 'stopping', null, activeRunIdRef.current)
    try {
      await stopChatRun(sessionId, activeRunIdRef.current)
    } catch (error) {
      stopRequestedRef.current = false
      setIsStopping(false)
      markSessionExecutionStatus(sessionId, 'running', null, activeRunIdRef.current)
      throw error
    }

    activeAbortControllerRef.current.abort()
  }, [isStopping, markSessionExecutionStatus, sessionId])

  const openDrawer = useCallback(async (step: ToolStep) => {
    const searchRequestId = step.searchRequestId
    const hasImages = step.images && step.images.length > 0

    if (searchRequestId) {
      setDrawerData({
        stepLabel: step.toolName,
        images: [],
        searchRequestId,
        tasteProfileId: defaultTasteProfileId,
        tasteProfileWeight: defaultTasteProfileWeight,
        offset: 0,
        hasMore: true,
        isLoadingMore: true,
        emptyState: 'none',
      })
      setDrawerOpen(true)

      try {
        const data = await fetchSearchSessionById(
          searchRequestId,
          0,
          20,
          defaultTasteProfileId,
          defaultTasteProfileWeight,
        )
        setDrawerData(prev => prev ? {
          ...prev,
          images: data.images || [],
          offset: data.offset + data.limit,
          hasMore: data.has_more,
          total: data.total,
          isLoadingMore: false,
          emptyState: (data.images || []).length > 0 ? 'none' : 'empty',
        } : null)
      } catch (e) {
        console.error('load search session error', e)
        setDrawerData(prev => prev ? {
          ...prev,
          images: [],
          offset: 0,
          hasMore: false,
          total: 0,
          isLoadingMore: false,
          emptyState: 'unavailable',
        } : null)
      }
    } else if (hasImages) {
      setDrawerData({
        stepLabel: step.toolName,
        images: step.images!,
        searchRequestId: null,
        tasteProfileId: defaultTasteProfileId,
        tasteProfileWeight: defaultTasteProfileWeight,
        offset: 0,
        hasMore: false,
        isLoadingMore: false,
        emptyState: step.images!.length > 0 ? 'none' : 'empty',
      })
      setDrawerOpen(true)
    }
  }, [defaultTasteProfileId, defaultTasteProfileWeight])

  /** Open drawer directly from a search_request_id (used by SearchResultCard) */
  const openDrawerFromSearchRequestId = useCallback(async (searchRequestId: string) => {
    setDrawerData({
      stepLabel: 'show_collection',
      images: [],
      searchRequestId,
      tasteProfileId: defaultTasteProfileId,
      tasteProfileWeight: defaultTasteProfileWeight,
      offset: 0,
      hasMore: true,
      isLoadingMore: true,
      emptyState: 'none',
    })
    setDrawerOpen(true)

    try {
      const data = await fetchSearchSessionById(
        searchRequestId,
        0,
        20,
        defaultTasteProfileId,
        defaultTasteProfileWeight,
      )
      setDrawerData(prev => prev ? {
        ...prev,
        images: data.images || [],
        offset: data.offset + data.limit,
        hasMore: data.has_more,
        total: data.total,
        isLoadingMore: false,
        emptyState: (data.images || []).length > 0 ? 'none' : 'empty',
      } : null)
    } catch (e) {
      console.error('load search session error', e)
      setDrawerData(prev => prev ? {
        ...prev,
        images: [],
        offset: 0,
        hasMore: false,
        total: 0,
        isLoadingMore: false,
        emptyState: 'unavailable',
      } : null)
    }
  }, [defaultTasteProfileId, defaultTasteProfileWeight])

  const loadMoreDrawerImages = useCallback(async () => {
    if (!drawerData?.searchRequestId || !drawerData.hasMore) return

    setDrawerData(prev => prev ? { ...prev, isLoadingMore: true } : null)
    try {
      const data = await fetchSearchSessionById(
        drawerData.searchRequestId,
        drawerData.offset,
        20,
        drawerData.tasteProfileId ?? null,
        drawerData.tasteProfileWeight ?? null,
      )
      setDrawerData(prev => prev ? {
        ...prev,
        images: [...prev.images, ...(data.images || [])],
        offset: data.offset + data.limit,
        hasMore: data.has_more,
        isLoadingMore: false,
        emptyState: [...prev.images, ...(data.images || [])].length > 0 ? 'none' : 'empty',
      } : null)
    } catch (e) {
      console.error(e)
      setDrawerData(prev => prev ? {
        ...prev,
        hasMore: false,
        isLoadingMore: false,
        emptyState: prev.images.length > 0 ? 'none' : 'unavailable',
      } : null)
    }
  }, [drawerData])

  const applyDrawerTasteProfile = useCallback(async ({
    tasteProfileId,
    tasteProfileWeight,
  }: {
    tasteProfileId: string | null
    tasteProfileWeight?: number | null
  }) => {
    if (!drawerData?.searchRequestId) return
    const nextWeight = tasteProfileId
      ? (typeof tasteProfileWeight === 'number' ? tasteProfileWeight : (drawerData.tasteProfileWeight ?? defaultTasteProfileWeight ?? 0.24))
      : 0.24

    setDrawerData(prev => prev ? {
      ...prev,
      images: [],
      offset: 0,
      tasteProfileId,
      tasteProfileWeight: nextWeight,
      hasMore: true,
      isLoadingMore: true,
      emptyState: 'none',
    } : null)

    try {
      const data = await fetchSearchSessionById(
        drawerData.searchRequestId,
        0,
        20,
        tasteProfileId,
        nextWeight,
      )
      setDrawerData(prev => prev ? {
        ...prev,
        images: data.images || [],
        offset: data.offset + data.limit,
        hasMore: data.has_more,
        total: data.total,
        isLoadingMore: false,
        tasteProfileId,
        tasteProfileWeight: nextWeight,
        emptyState: (data.images || []).length > 0 ? 'none' : 'empty',
      } : null)
    } catch (error) {
      console.error(error)
      setDrawerData(prev => prev ? {
        ...prev,
        isLoadingMore: false,
        hasMore: false,
        tasteProfileId,
        tasteProfileWeight: nextWeight,
        emptyState: prev.images.length > 0 ? 'none' : 'unavailable',
      } : null)
    }
  }, [defaultTasteProfileWeight, drawerData])

  return {
    messages,
    isLoading,
    isStopping,
    stopMessage,
    sendMessage,
    drawerOpen,
    setDrawerOpen,
    drawerData,
    openDrawer,
    openDrawerFromSearchRequestId,
    loadMoreDrawerImages,
    applyDrawerTasteProfile,
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
