import { cloneElement, forwardRef, isValidElement, type ButtonHTMLAttributes, type MouseEvent, type ReactElement } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'type-action-label inline-flex items-center justify-center gap-2 border rounded-[var(--radius-sm)] transition-all duration-fast focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none',
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-primary-foreground hover:bg-transparent hover:text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground hover:border-foreground hover:bg-background',
        outline: 'border-border bg-transparent text-foreground hover:border-foreground hover:bg-accent',
        ghost: 'border-transparent bg-transparent text-muted-foreground hover:text-foreground hover:border-border',
        destructive: 'border-foreground bg-transparent text-foreground hover:bg-foreground hover:text-background',
        ghostGlass: 'border-border bg-background/80 text-foreground hover:border-foreground hover:bg-background',
      },
      size: {
        default: 'min-h-11 px-4 py-3',
        sm: 'min-h-9 px-3',
        lg: 'min-h-12 px-6',
        icon: 'h-11 w-11 px-0',
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

const spinnerNode = (
  <svg
    className="h-4 w-4 animate-spin"
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
)

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, onClick, ...props }, ref) => {
    const resolvedClassName = cn(buttonVariants({ variant, size, className }))
    const isDisabled = disabled || loading

    if (asChild && isValidElement(children)) {
      const child = children as ReactElement<{ className?: string; children?: unknown; onClick?: (event: MouseEvent) => void }>

      return cloneElement(child, {
        ...(props as Record<string, unknown>),
        className: cn(resolvedClassName, child.props.className),
        'aria-disabled': isDisabled || undefined,
        'data-disabled': isDisabled ? '' : undefined,
        onClick: isDisabled
          ? (event: MouseEvent) => {
              event.preventDefault()
            }
          : (onClick ?? child.props.onClick),
        children: (
          <>
            {loading ? spinnerNode : null}
            {child.props.children}
          </>
        ),
      } as Record<string, unknown>)
    }

    return (
      <button
        className={resolvedClassName}
        ref={ref}
        disabled={isDisabled}
        onClick={onClick}
        {...props}
      >
        {loading ? spinnerNode : null}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
