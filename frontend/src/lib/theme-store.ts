import { useSyncExternalStore } from 'react'

export type ThemeMode = 'light' | 'dark'

const LEGACY_THEME_KEY = 'fashion-report-theme'
const THEME_KEY = 'theme'

type ThemeStore = {
  theme: ThemeMode
}

const listeners = new Set<() => void>()

function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY)
  return stored === 'dark' || stored === 'light' ? stored : getSystemTheme()
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

let store: ThemeStore = {
  theme: readStoredTheme(),
}

applyTheme(store.theme)

function emit() {
  listeners.forEach(listener => listener())
}

function persistTheme(theme: ThemeMode) {
  if (typeof window === 'undefined') return
  localStorage.setItem(THEME_KEY, theme)
  localStorage.setItem(LEGACY_THEME_KEY, theme)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== LEGACY_THEME_KEY) return
    const nextTheme = readStoredTheme()
    if (nextTheme === store.theme) return
    store = { theme: nextTheme }
    applyTheme(nextTheme)
    emit()
  }

  window.addEventListener('storage', handleStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}

function getSnapshot(): ThemeStore {
  return store
}

export function initializeTheme() {
  const nextTheme = readStoredTheme()
  store = { theme: nextTheme }
  applyTheme(nextTheme)
  persistTheme(nextTheme)
}

export function setTheme(theme: ThemeMode) {
  if (theme === store.theme) return
  store = { theme }
  applyTheme(theme)
  persistTheme(theme)
  emit()
}

export function toggleTheme() {
  setTheme(store.theme === 'dark' ? 'light' : 'dark')
}

export function useThemeStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    theme: state.theme,
    setTheme,
    toggleTheme,
  }
}
