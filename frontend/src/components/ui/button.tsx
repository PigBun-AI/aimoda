import { Slot } from '@radix-ui/react-slot'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'text-sm font-medium',
    'rounded-[var(--radius-sm)]',
    'transition-all duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]',
    'disabled:pointer-events-none disabled:opacity-50',
    'cursor-pointer',
    'select-none',
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'bg-[var(--text-primary)] text-[var(--bg-primary)]',
          'shadow-[var(--shadow-sm)]',
          'hover:shadow-[var(--shadow-md)] hover:bg-[var(--text-primary)]/90',
          'active:scale-[0.98] active:shadow-[var(--shadow-xs)]',
        ].join(' '),
        secondary: [
          'bg-[var(--bg-tertiary)] text-[var(--text-primary)]',
          'border border-[var(--border-color)]',
          'hover:bg-[var(--bg-secondary)] hover:border-[var(--text-muted)]',
          'active:scale-[0.98]',
        ].join(' '),
        outline: [
          'bg-transparent text-[var(--text-primary)]',
          'border border-[var(--border-color)]',
          'hover:bg-[var(--bg-secondary)] hover:border-[var(--text-secondary)]',
          'active:bg-[var(--bg-tertiary)]',
        ].join(' '),
        ghost: [
          'bg-transparent text-[var(--text-secondary)]',
          'hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
          'active:bg-[var(--bg-secondary)]',
        ].join(' '),
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }