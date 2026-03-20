import type { RedemptionCodeType } from './types'

export const REDEMPTION_CODE_TYPE_LABELS: Record<RedemptionCodeType, string> = {
  '1week': '1 week',
  '1month': '1 month',
  '3months': '3 months',
  '1year': '1 year',
}

// Responsive breakpoint pixel values (must match tailwind config)
export const BREAKPOINT_PX = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const
