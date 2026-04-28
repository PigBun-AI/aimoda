import { BREAKPOINT_PX } from '@/lib/constants'

export const APP_SHELL_PINNED_SIDEBAR_MIN_WIDTH = BREAKPOINT_PX.xl
export const APP_SHELL_FULL_DESKTOP_MIN_WIDTH = BREAKPOINT_PX['2xl'] - 96
export const APP_SHELL_PINNED_SIDEBAR_MIN_HEIGHT = 860

export function shouldPinAppShellSidebar(width: number, height = Number.POSITIVE_INFINITY) {
  if (width >= APP_SHELL_FULL_DESKTOP_MIN_WIDTH) {
    return true
  }

  return width >= APP_SHELL_PINNED_SIDEBAR_MIN_WIDTH && height >= APP_SHELL_PINNED_SIDEBAR_MIN_HEIGHT
}
