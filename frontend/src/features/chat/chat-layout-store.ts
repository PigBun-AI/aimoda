import { useSyncExternalStore } from 'react'

type ChatLayoutStore = {
  isDrawerFullscreen: boolean
}

const initialStore: ChatLayoutStore = {
  isDrawerFullscreen: false,
}

let store: ChatLayoutStore = initialStore

const listeners = new Set<() => void>()

function getSnapshot(): ChatLayoutStore {
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

export function setDrawerFullscreen(isDrawerFullscreen: boolean) {
  if (store.isDrawerFullscreen === isDrawerFullscreen) return
  store = {
    ...store,
    isDrawerFullscreen,
  }
  emit()
}

export function resetChatLayoutStore() {
  store = { ...initialStore }
  emit()
}

export function useChatLayoutStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return {
    isDrawerFullscreen: state.isDrawerFullscreen,
    setDrawerFullscreen,
    resetChatLayoutStore,
  }
}
