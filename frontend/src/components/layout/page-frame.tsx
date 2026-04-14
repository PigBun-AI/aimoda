import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface PageFrameProps {
  children: ReactNode
  className?: string
  innerClassName?: string
  fullHeight?: boolean
  width?: 'default' | 'wide' | 'full'
  density?: 'compact' | 'comfortable'
}

const widthClasses = {
  default: 'max-w-6xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
} as const

export function PageFrame({
  children,
  className,
  innerClassName,
  fullHeight = false,
  width = 'default',
  density = 'compact',
}: PageFrameProps) {
  return (
    <section
      className={cn(
        density === 'comfortable'
          ? 'bg-background px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 xl:px-10'
          : 'bg-background px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6 xl:px-8',
        fullHeight && 'flex h-full min-h-0 flex-col',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto w-full',
          widthClasses[width],
          fullHeight && 'flex h-full min-h-0 flex-col',
          innerClassName,
        )}
      >
        {children}
      </div>
    </section>
  )
}
