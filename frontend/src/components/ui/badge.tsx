import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all duration-150',
  {
    variants: {
      variant: {
        default: 'bg-accent text-muted-foreground border-transparent',
        primary: 'bg-primary text-primary-foreground border-transparent',
        success: 'border-transparent bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]',
        warning: 'border-transparent bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]',
        error: 'border-transparent bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]',
      },
      size: {
        sm: 'text-[10px] px-1.5 py-0',
        default: 'text-xs px-2.5 py-0.5',
        lg: 'text-sm px-3 py-1',
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
