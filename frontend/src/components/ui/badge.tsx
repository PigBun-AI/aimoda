import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'type-kicker inline-flex min-h-6 items-center gap-1 rounded-[2px] border px-2 py-1 transition-all duration-150',
  {
    variants: {
      variant: {
        default: 'border-border bg-transparent text-muted-foreground',
        primary: 'border-primary bg-primary text-primary-foreground',
        success: 'border-border bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]',
        warning: 'border-dashed border-border bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]',
        error: 'border-foreground bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]',
      },
      size: {
        sm: 'min-h-5 px-1.5 py-0.5',
        default: 'min-h-6 px-2 py-1',
        lg: 'min-h-7 px-2.5 py-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
