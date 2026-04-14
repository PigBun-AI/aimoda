import { BREAKPOINT_PX } from '@/lib/constants'

export const APP_SHELL_PINNED_SIDEBAR_MIN_WIDTH = BREAKPOINT_PX.xl

export function shouldPinAppShellSidebar(width: number) {
  return width >= APP_SHELL_PINNED_SIDEBAR_MIN_WIDTH
}
