import { useEffect, useState } from 'react'

const DEFAULT_PAGE_ANCHOR_GAP = 24
const DEFAULT_STICKY_HEADER_SELECTOR = '[data-page-sticky-header="true"]'

function getVisibleStickyHeaderBottom(headerSelector: string): number {
  if (typeof window === 'undefined') return 0

  const headers = Array.from(document.querySelectorAll<HTMLElement>(headerSelector))
  let maxBottom = 0

  for (const header of headers) {
    const styles = window.getComputedStyle(header)
    if (styles.display === 'none' || styles.visibility === 'hidden') continue

    const rect = header.getBoundingClientRect()
    if (rect.height <= 0 || rect.bottom <= 0) continue

    maxBottom = Math.max(maxBottom, rect.bottom)
  }

  return Math.ceil(maxBottom)
}

export function usePageStickyAnchorOffset(options?: {
  headerSelector?: string
  gap?: number
}) {
  const headerSelector = options?.headerSelector ?? DEFAULT_STICKY_HEADER_SELECTOR
  const gap = options?.gap ?? DEFAULT_PAGE_ANCHOR_GAP
  const [offset, setOffset] = useState(() => getVisibleStickyHeaderBottom(headerSelector) + gap)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const updateOffset = () => {
      setOffset(getVisibleStickyHeaderBottom(headerSelector) + gap)
    }

    updateOffset()

    const headers = Array.from(document.querySelectorAll<HTMLElement>(headerSelector))
    const observers: ResizeObserver[] = []

    if (typeof ResizeObserver !== 'undefined') {
      for (const header of headers) {
        const observer = new ResizeObserver(() => updateOffset())
        observer.observe(header)
        observers.push(observer)
      }
    }

    window.addEventListener('resize', updateOffset)
    return () => {
      window.removeEventListener('resize', updateOffset)
      observers.forEach(observer => observer.disconnect())
    }
  }, [gap, headerSelector])

  return offset
}

export function scrollPageAnchorIntoView(target: HTMLElement | null, behavior: ScrollBehavior = 'smooth') {
  if (!target) return
  target.scrollIntoView({
    behavior,
    block: 'start',
    inline: 'nearest',
  })
}
