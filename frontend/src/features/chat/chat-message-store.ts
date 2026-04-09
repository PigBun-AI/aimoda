import { useSyncExternalStore } from 'react'

import type { ChatMessage } from './chat-types'

type PendingHydration = {
  requestId: number
  baseRevision: number
}

type SessionChatState = {
  messages: ChatMessage[]
  hydrated: boolean
  isStreaming: boolean
  localRevision: number
  nextHydrationRequestId: number
  pendingHydration: PendingHydration | null
}

type ChatMessageStore = {
  sessions: Record<string, SessionChatState>
}

const initialStore: ChatMessageStore = {
  sessions: {},
}

let store: ChatMessageStore = initialStore

const listeners = new Set<() => void>()

function createSessionState(): SessionChatState {
  return {
    messages: [],
    hydrated: false,
    isStreaming: false,
    localRevision: 0,
    nextHydrationRequestId: 1,
    pendingHydration: null,
  }
}

function getSnapshot(): ChatMessageStore {
  return store
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit() {
  store = { ...store }
  listeners.forEach(listener => listener())
}

function updateSessionState(
  sessionId: string,
  updater: (current: SessionChatState) => SessionChatState,
  options?: { createIfMissing?: boolean },
): SessionChatState | null {
  const createIfMissing = options?.createIfMissing ?? true
  const current = store.sessions[sessionId]
  if (!current && !createIfMissing) return null

  const next = updater(current ?? createSessionState())
  if (next === current) {
    return current ?? next
  }

  store = {
    ...store,
    sessions: {
      ...store.sessions,
      [sessionId]: next,
    },
  }
  emit()
  return next
}

export function requestSessionHydration(sessionId: string): PendingHydration {
  let pending: PendingHydration = { requestId: 1, baseRevision: 0 }

  updateSessionState(sessionId, current => {
    pending = {
      requestId: current.nextHydrationRequestId,
      baseRevision: current.localRevision,
    }
    return {
      ...current,
      nextHydrationRequestId: current.nextHydrationRequestId + 1,
      pendingHydration: pending,
    }
  })

  return pending
}

export function applyHydratedMessages(
  sessionId: string,
  requestId: number,
  baseRevision: number,
  messages: ChatMessage[],
) {
  updateSessionState(
    sessionId,
    current => {
      if (!current.pendingHydration || current.pendingHydration.requestId !== requestId) {
        return current
      }

      const shouldReplaceMessages = current.localRevision === baseRevision
      return {
        ...current,
        hydrated: true,
        pendingHydration: null,
        messages: shouldReplaceMessages ? messages : current.messages,
      }
    },
    { createIfMissing: false },
  )
}

export function appendOptimisticExchange(
  sessionId: string,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage,
) {
  updateSessionState(sessionId, current => ({
    ...current,
    hydrated: true,
    isStreaming: true,
    localRevision: current.localRevision + 1,
    messages: [...current.messages, userMessage, assistantMessage],
  }))
}

export function replaceAssistantMessage(
  sessionId: string,
  assistantMessageId: string,
  content: ChatMessage['content'],
  metadata?: ChatMessage['metadata'],
) {
  updateSessionState(sessionId, current => ({
    ...current,
    hydrated: true,
    localRevision: current.localRevision + 1,
    messages: current.messages.map(message => (
      message.id === assistantMessageId
        ? { ...message, content, ...(metadata ? { metadata } : {}) }
        : message
    )),
  }))
}

export function finishSessionStream(sessionId: string) {
  updateSessionState(
    sessionId,
    current => (current.isStreaming ? { ...current, isStreaming: false } : current),
    { createIfMissing: false },
  )
}

export function removeMessage(sessionId: string, messageId: string) {
  updateSessionState(
    sessionId,
    current => ({
      ...current,
      hydrated: true,
      localRevision: current.localRevision + 1,
      messages: current.messages.filter(message => message.id !== messageId),
    }),
    { createIfMissing: false },
  )
}

export function removeSessionMessages(sessionId: string) {
  if (!(sessionId in store.sessions)) return

  const nextSessions = { ...store.sessions }
  delete nextSessions[sessionId]
  store = {
    ...store,
    sessions: nextSessions,
  }
  emit()
}

export function resetChatMessageStore() {
  store = { ...initialStore }
  emit()
}

export function useChatMessageStore(sessionId: string | null) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const sessionState = sessionId ? state.sessions[sessionId] : null

  return {
    messages: sessionState?.messages ?? [],
    isLoading: sessionState?.isStreaming ?? false,
    hydrated: sessionState?.hydrated ?? false,
  }
}
