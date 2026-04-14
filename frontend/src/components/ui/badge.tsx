import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'type-chat-kicker inline-flex min-h-5 items-center gap-1 rounded-none border px-2 py-0.5 transition-[background-color,border-color,color,transform] duration-150',
  {
    variants: {
      variant: {
        default: 'border-border/70 bg-background text-muted-foreground',
        primary: 'border-primary bg-primary text-primary-foreground',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/12 text-warning',
        error: 'border-transparent bg-destructive text-primary-foreground',
      },
      size: {
        sm: 'min-h-4 px-1.5 py-0.5',
        default: 'min-h-5 px-2 py-0.5',
        lg: 'min-h-6 px-2.5 py-1',
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
