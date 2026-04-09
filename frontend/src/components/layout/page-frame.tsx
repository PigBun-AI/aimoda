import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface PageFrameProps {
  children: ReactNode
  className?: string
  innerClassName?: string
  fullHeight?: boolean
}

export function PageFrame({ children, className, innerClassName, fullHeight = false }: PageFrameProps) {
  return (
    <section
      className={cn(
        'bg-background px-4 py-4 sm:px-6 sm:py-6 lg:px-8',
        fullHeight && 'flex h-full min-h-0 flex-col',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto w-full max-w-6xl',
          fullHeight && 'flex h-full min-h-0 flex-col',
          innerClassName,
        )}
      >
        {children}
      </div>
    </section>
  )
}
