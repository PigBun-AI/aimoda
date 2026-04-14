import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface PageIntroProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
  variant?: 'compact' | 'editorial'
  className?: string
  titleClassName?: string
  descriptionClassName?: string
}

export function PageIntro({
  eyebrow,
  title,
  description,
  aside,
  variant = 'compact',
  className,
  titleClassName,
  descriptionClassName,
}: PageIntroProps) {
  return (
    <header
      className={cn(
        variant === 'editorial'
          ? 'grid gap-5 border-t border-border/70 pt-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(15rem,0.72fr)] xl:gap-8 xl:pt-7'
          : 'grid gap-4 border-t border-border/70 pt-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(14.5rem,0.72fr)] xl:gap-7 xl:pt-6',
        className,
      )}
    >
      <div className={cn(variant === 'editorial' ? 'space-y-3.5' : 'space-y-2.5')}>
        {eyebrow ? <div className="type-chat-kicker text-muted-foreground tabular-nums">{eyebrow}</div> : null}
        <div className={cn(variant === 'editorial' ? 'type-page-title max-w-[12ch] text-balance text-foreground' : 'type-page-title max-w-[13ch] text-balance text-foreground', titleClassName)}>{title}</div>
        {description ? (
          <div className={cn(variant === 'editorial' ? 'type-body-muted max-w-[42ch] text-pretty' : 'type-body-muted max-w-[38ch] text-pretty', descriptionClassName)}>{description}</div>
        ) : null}
      </div>

      {aside ? (
        <div className={cn(
          'border border-border/60 bg-card shadow-token-sm',
          variant === 'editorial' ? 'px-5 py-5' : 'px-4 py-4 sm:px-5 sm:py-5',
        )}>
          {aside}
        </div>
      ) : null}
    </header>
  )
}
