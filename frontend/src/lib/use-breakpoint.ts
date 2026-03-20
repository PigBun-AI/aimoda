import { useSyncExternalStore } from 'react'

export const BREAKPOINTS = {
  mobile: 640,
  sm: 768,
  md: 1024,
  lg: 1280,
  xl: 1536,
  '2xl': Infinity,
} as const

export type BreakpointKey = keyof typeof BREAKPOINTS

export function getBreakpoint(width: number): BreakpointKey {
  if (width < BREAKPOINTS.mobile) return 'mobile'
  if (width < BREAKPOINTS.sm) return 'sm'
  if (width < BREAKPOINTS.md) return 'md'
  if (width < BREAKPOINTS.lg) return 'lg'
  if (width < BREAKPOINTS.xl) return 'xl'
  return '2xl'
}

const DEBOUNCE_MS = 300

function getSnapshot(): BreakpointKey {
  if (typeof window === 'undefined') return 'lg'
  return getBreakpoint(window.innerWidth)
}

function getServerSnapshot(): BreakpointKey {
  return 'lg'
}

function subscribe(callback: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const handler = () => {
    clearTimeout(timer)
    timer = setTimeout(callback, DEBOUNCE_MS)
  }

  window.addEventListener('resize', handler, { passive: true })
  return () => {
    window.removeEventListener('resize', handler)
    clearTimeout(timer)
  }
}

export function useBreakpoint(): BreakpointKey {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile'
}

export function useIsTablet(): boolean {
  const bp = useBreakpoint()
  return bp === 'sm' || bp === 'md'
}

export function useIsDesktop(): boolean {
  const bp = useBreakpoint()
  return bp === 'lg' || bp === 'xl' || bp === '2xl'
}
