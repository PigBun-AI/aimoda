import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface ArchiveSplitCardProps {
  media: ReactNode
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  counter?: ReactNode
  chips?: ReactNode
  footerStart?: ReactNode
  footerEnd?: ReactNode
  className?: string
  mediaClassName?: string
  bodyClassName?: string
  titleClassName?: string
  descriptionClassName?: string
}

export function ArchiveSplitCard({
  media,
  title,
  description,
  eyebrow,
  counter,
  chips,
  footerStart,
  footerEnd,
  className,
  mediaClassName,
  bodyClassName,
  titleClassName,
  descriptionClassName,
}: ArchiveSplitCardProps) {
  return (
    <Card className={cn('h-full overflow-hidden border-border/80 bg-background shadow-none', className)}>
      <div className="grid h-full min-h-[23rem] grid-cols-[minmax(170px,0.94fr)_minmax(0,1.06fr)]">
        <div className={cn('relative min-h-full overflow-hidden border-r border-border/80 bg-background', mediaClassName)}>
          {media}
        </div>

        <div className={cn('flex min-w-0 flex-col justify-between px-5 py-5 sm:px-6 sm:py-6', bodyClassName)}>
          <div className="space-y-5">
            {(eyebrow || counter) && (
              <div className="flex items-start justify-between gap-4 border-b border-border/80 pb-4">
                <div className="min-w-0">{eyebrow}</div>
                {counter && <div className="shrink-0">{counter}</div>}
              </div>
            )}

            <div className="space-y-3.5">
              <div className={cn('font-role-editorial text-[clamp(1.28rem,1.1rem+0.48vw,1.72rem)] leading-[0.98] tracking-[0.008em] text-foreground', titleClassName)}>
                {title}
              </div>
              {description && (
                <div className={cn('type-body-muted max-w-[30ch] text-foreground/70', descriptionClassName)}>
                  {description}
                </div>
              )}
            </div>

            {chips && <div className="flex flex-wrap gap-1.5 pt-1">{chips}</div>}
          </div>

          {(footerStart || footerEnd) && (
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border/80 pt-4">
              <div className="min-w-0">{footerStart}</div>
              <div className="shrink-0">{footerEnd}</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
