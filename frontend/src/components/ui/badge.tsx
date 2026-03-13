import { forwardRef, type HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = {
  default: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-color)]',
  primary: 'bg-[var(--text-primary)] text-[var(--bg-primary)] border-transparent',
  gold: 'bg-[var(--gold-muted)] text-[var(--gold)] border-[var(--gold)]/30',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  error: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
}

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof badgeVariants
}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(({ className, variant = 'default', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      [
        'inline-flex items-center gap-1',
        'rounded-full border px-2.5 py-0.5',
        'text-xs font-medium',
        'transition-all duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
        badgeVariants[variant],
      ].join(' '),
      className,
    )}
    {...props}
  />
))
Badge.displayName = 'Badge'

export { Badge, badgeVariants }