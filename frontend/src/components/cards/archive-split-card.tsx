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
    <Card className={cn('h-full overflow-hidden border-border/60 bg-card', className)}>
      <div className="grid h-full min-h-[23rem] grid-cols-1 md:grid-cols-[minmax(190px,0.98fr)_minmax(0,1.02fr)]">
        <div className={cn('relative min-h-[15rem] overflow-hidden bg-muted/20 md:min-h-full md:border-r md:border-border/60', mediaClassName)}>
          {media}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/14 via-transparent to-transparent opacity-80 mix-blend-multiply dark:from-black/40" />
        </div>

        <div className={cn('flex min-w-0 flex-col justify-between bg-[linear-gradient(180deg,rgba(255,255,255,0.18),transparent_32%)] px-5 py-5 sm:px-6 sm:py-6', bodyClassName)}>
          <div className="space-y-6">
            {(eyebrow || counter) && (
              <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-4">
                <div className="min-w-0">{eyebrow}</div>
                {counter && <div className="shrink-0 border border-border/60 bg-background px-3 py-1 shadow-token-sm">{counter}</div>}
              </div>
            )}

            <div className="space-y-4">
              <div className={cn('font-role-editorial text-[clamp(1.5rem,1.18rem+0.72vw,2.1rem)] leading-[0.92] tracking-[-0.03em] text-foreground', titleClassName)}>
                {title}
              </div>
              {description && (
                <div className={cn('type-body-muted max-w-[32ch] text-foreground/70', descriptionClassName)}>
                  {description}
                </div>
              )}
            </div>

            {chips && <div className="flex flex-wrap gap-2 pt-1">{chips}</div>}
          </div>

          {(footerStart || footerEnd) && (
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
              <div className="min-w-0">{footerStart}</div>
              <div className="shrink-0">{footerEnd}</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
