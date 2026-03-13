import { forwardRef, type HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const Separator = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('h-px w-full bg-border', className)} role="separator" {...props} />
))
Separator.displayName = 'Separator'

export { Separator }
