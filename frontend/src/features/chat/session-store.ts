/**
 * Shared session store — module-level singleton to avoid duplicate API calls
 * and React re-render loops between app-shell.tsx and chat-page.tsx.
 */

import { useSyncExternalStore } from 'react'
import i18n from '@/i18n'
import type { ChatSession } from './chat-types'
import {
  listSessions as apiListSessions,
  createSession as apiCreateSession,
  deleteSessionApi,
  updateSession as apiUpdateSession,
} from './chat-api'

export type SessionNotification = {
  id: string
  sessionId: string
  kind: 'completed' | 'error'
  title: string
  message: string
  createdAt: string
}

type SessionStore = {
  sessions: ChatSession[]
  activeSessionId: string | null
  isLoading: boolean
  loaded: boolean
  notifications: SessionNotification[]
}

const initialStore: SessionStore = {
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  loaded: false,
  notifications: [],
}

let store: SessionStore = initialStore

const listeners = new Set<() => void>()

function getSnapshot(): SessionStore {
  return store
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit() {
  store = { ...store }
  listeners.forEach(fn => fn())
}

function sessionTime(value?: string | null): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => {
    const pinnedDiff = Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned))
    if (pinnedDiff !== 0) return pinnedDiff

    const pinnedAtDiff = sessionTime(b.pinned_at) - sessionTime(a.pinned_at)
    if (pinnedAtDiff !== 0) return pinnedAtDiff

    return sessionTime(b.updated_at) - sessionTime(a.updated_at)
  })
}

function ensureSortedStore(partial: Partial<SessionStore>) {
  store = {
    ...store,
    ...partial,
    sessions: sortSessions(partial.sessions ?? store.sessions),
  }
}

function pickNextActiveSession(nextSessions: ChatSession[], currentId: string | null): string | null {
  if (currentId && nextSessions.some(session => session.id === currentId)) {
    return currentId
  }
  return nextSessions[0]?.id ?? null
}

function buildNotification(session: ChatSession): SessionNotification | null {
  if (session.execution_status !== 'completed' && session.execution_status !== 'error') {
    return null
  }

  const completionStamp = session.last_run_completed_at ?? session.updated_at
  const kind = session.execution_status

  return {
    id: `${session.id}:${kind}:${completionStamp}`,
    sessionId: session.id,
    kind,
    title: kind === 'completed'
      ? i18n.t('common:sessionCompletedTitle')
      : i18n.t('common:sessionFailedTitle'),
    message: kind === 'completed'
      ? i18n.t('common:sessionCompletedMessage', { title: session.title })
      : session.last_run_error || i18n.t('common:sessionFailedMessage', { title: session.title }),
    createdAt: completionStamp,
  }
}

function collectCompletionNotifications(
  previousSessions: ChatSession[],
  nextSessions: ChatSession[],
): SessionNotification[] {
  const previousMap = new Map(previousSessions.map(session => [session.id, session]))
  return nextSessions
    .map(session => {
      const previous = previousMap.get(session.id)
      if (!previous || previous.execution_status !== 'running') return null
      return buildNotification(session)
    })
    .filter((item): item is SessionNotification => Boolean(item))
}

function mergeNotifications(current: SessionNotification[], incoming: SessionNotification[]) {
  if (incoming.length === 0) return current
  const existingIds = new Set(current.map(item => item.id))
  const nextItems = incoming.filter(item => !existingIds.has(item.id))
  return nextItems.length > 0 ? [...nextItems, ...current] : current
}

function reconcileFetchedSession(previous: ChatSession | undefined, incoming: ChatSession): ChatSession {
  if (!previous) return incoming

  const previousUpdatedAt = sessionTime(previous.updated_at)
  const previousStartedAt = sessionTime(previous.last_run_started_at)
  const incomingUpdatedAt = sessionTime(incoming.updated_at)
  const incomingStartedAt = sessionTime(incoming.last_run_started_at)
  const previousTitleSource = previous.title_source ?? 'default'
  const incomingTitleSource = incoming.title_source ?? 'default'

  let next = incoming

  const shouldPreserveOptimisticTitle =
    previousUpdatedAt > incomingUpdatedAt &&
    previous.title !== incoming.title &&
    (previousTitleSource === 'heuristic' || previous.title_locked || previousTitleSource === 'manual') &&
    incomingTitleSource === 'default'

  if (shouldPreserveOptimisticTitle) {
    next = {
      ...incoming,
      title: previous.title,
      title_source: previous.title_source,
      title_locked: previous.title_locked,
      message_count: Math.max(previous.message_count ?? 0, incoming.message_count ?? 0),
      updated_at: previous.updated_at,
    }
  }

  if (
    previous.execution_status === 'running' &&
    next.execution_status === 'idle' &&
    previousStartedAt > incomingStartedAt
  ) {
    return {
      ...next,
      execution_status: previous.execution_status,
      last_run_started_at: previous.last_run_started_at,
      last_run_completed_at: previous.last_run_completed_at,
      last_run_error: previous.last_run_error,
      updated_at:
        previousUpdatedAt > sessionTime(next.updated_at)
          ? previous.updated_at
          : next.updated_at,
    }
  }

  return next
}

// ── Actions ──

let loadPromise: Promise<void> | null = null

export function loadSessions(): Promise<void> {
  if (loadPromise) return loadPromise

  store = { ...store, isLoading: !store.loaded }
  emit()

  loadPromise = apiListSessions()
    .then(data => {
      const previousMap = new Map(store.sessions.map(session => [session.id, session]))
      const nextSessions = sortSessions(data.map(session => reconcileFetchedSession(previousMap.get(session.id), session)))
      const notifications = collectCompletionNotifications(store.sessions, nextSessions)
      ensureSortedStore({
        sessions: nextSessions,
        isLoading: false,
        loaded: true,
        activeSessionId: pickNextActiveSession(nextSessions, store.activeSessionId),
        notifications: mergeNotifications(store.notifications, notifications),
      })
      emit()
    })
    .catch(err => {
      console.error('Failed to load sessions', err)
      store = { ...store, isLoading: false, loaded: true }
      emit()
    })
    .finally(() => {
      loadPromise = null
    })

  return loadPromise
}

export function setActiveSessionId(id: string | null) {
  if (store.activeSessionId === id) return
  store = { ...store, activeSessionId: id }
  emit()
}

export function resetSessionStore() {
  store = { ...initialStore }
  emit()
}

export async function createNewSession(): Promise<ChatSession | null> {
  try {
    const session = await apiCreateSession()
    const nextSessions = sortSessions([session, ...store.sessions])
    store = {
      ...store,
      sessions: nextSessions,
      activeSessionId: session.id,
    }
    emit()
    return session
  } catch (e) {
    console.error('Failed to create session', e)
    return null
  }
}

export async function renameSession(id: string, title: string): Promise<ChatSession | null> {
  try {
    const updated = await apiUpdateSession(id, { title })
    const nextSessions = sortSessions(store.sessions.map(session => (session.id === id ? updated : session)))
    store = { ...store, sessions: nextSessions }
    emit()
    return updated
  } catch (e) {
    console.error('Failed to rename session', e)
    return null
  }
}

export async function toggleSessionPinned(id: string, pinned: boolean): Promise<ChatSession | null> {
  try {
    const updated = await apiUpdateSession(id, { pinned })
    const nextSessions = sortSessions(store.sessions.map(session => (session.id === id ? updated : session)))
    store = {
      ...store,
      sessions: nextSessions,
      activeSessionId: pickNextActiveSession(nextSessions, store.activeSessionId),
    }
    emit()
    return updated
  } catch (e) {
    console.error('Failed to update session pinned state', e)
    return null
  }
}

export function markSessionExecutionStatus(
  id: string,
  executionStatus: ChatSession['execution_status'],
  errorMessage?: string | null,
) {
  const nextSessions = store.sessions.map(session => {
    if (session.id !== id) return session

    const now = new Date().toISOString()
    return {
      ...session,
      execution_status: executionStatus,
      last_run_started_at: executionStatus === 'running' ? now : session.last_run_started_at,
      last_run_completed_at:
        executionStatus === 'completed' || executionStatus === 'error'
          ? now
          : session.last_run_completed_at,
      last_run_error: executionStatus === 'error' ? errorMessage ?? session.last_run_error ?? null : null,
      updated_at: now,
    }
  })

  store = {
    ...store,
    sessions: sortSessions(nextSessions),
  }
  emit()
}

export function primeSessionForImmediateRun(
  id: string,
  patch?: {
    title?: string | null
  },
) {
  const now = new Date().toISOString()
  const nextSessions = store.sessions.map(session => {
    if (session.id !== id) return session

    const canPromoteTitle = !session.title_locked && (session.message_count ?? 0) === 0
    const nextTitle = canPromoteTitle && patch?.title?.trim() ? patch.title.trim() : session.title
    return {
      ...session,
      title: nextTitle,
      title_source: nextTitle !== session.title ? 'heuristic' : session.title_source,
      execution_status: 'running' as const,
      last_run_started_at: now,
      last_run_error: null,
      message_count: Math.max(session.message_count ?? 0, 1),
      updated_at: now,
    }
  })

  store = {
    ...store,
    sessions: sortSessions(nextSessions),
  }
  emit()
}

export async function removeSession(id: string): Promise<{ nextActiveSessionId: string | null; removedActive: boolean } | null> {
  try {
    await deleteSessionApi(id)
    const remaining = sortSessions(store.sessions.filter(session => session.id !== id))
    const removedActive = store.activeSessionId === id
    const nextActiveSessionId = removedActive
      ? (remaining[0]?.id ?? null)
      : pickNextActiveSession(remaining, store.activeSessionId)

    store = {
      ...store,
      sessions: remaining,
      activeSessionId: nextActiveSessionId,
      notifications: store.notifications.filter(item => item.sessionId !== id),
    }
    emit()
    return { nextActiveSessionId, removedActive }
  } catch (e) {
    console.error('Failed to delete session', e)
    return null
  }
}

export function dismissSessionNotification(id: string) {
  if (!store.notifications.some(item => item.id === id)) return
  store = {
    ...store,
    notifications: store.notifications.filter(item => item.id !== id),
  }
  emit()
}

// ── React Hook ──

export function useSessionStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return {
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    isLoading: state.isLoading,
    loaded: state.loaded,
    notifications: state.notifications,
    loadSessions,
    setActiveSessionId,
    resetSessionStore,
    newSession: createNewSession,
    renameSession,
    toggleSessionPinned,
    primeSessionForImmediateRun,
    markSessionExecutionStatus,
    removeSession,
    dismissSessionNotification,
  }
}
