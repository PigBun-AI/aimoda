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
    <Card className={cn('h-full overflow-hidden bg-card', className)}>
      <div className="grid h-full min-h-[22rem] grid-cols-[minmax(160px,1fr)_minmax(0,1fr)]">
        <div className={cn('relative min-h-full overflow-hidden border-r border-border bg-muted', mediaClassName)}>
          {media}
        </div>

        <div className={cn('flex min-w-0 flex-col justify-between p-5 sm:p-6', bodyClassName)}>
          <div className="space-y-4">
            {(eyebrow || counter) && (
              <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                <div className="min-w-0">{eyebrow}</div>
                {counter && <div className="shrink-0">{counter}</div>}
              </div>
            )}

            <div className="space-y-3">
              <div className={cn('font-role-editorial text-[clamp(1.35rem,1.12rem+0.55vw,1.9rem)] leading-[0.96] tracking-[0.01em] text-foreground', titleClassName)}>
                {title}
              </div>
              {description && (
                <div className={cn('type-body-muted text-foreground/72', descriptionClassName)}>
                  {description}
                </div>
              )}
            </div>

            {chips && <div className="flex flex-wrap gap-1.5">{chips}</div>}
          </div>

          {(footerStart || footerEnd) && (
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
              <div className="min-w-0">{footerStart}</div>
              <div className="shrink-0">{footerEnd}</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
