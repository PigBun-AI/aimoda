import { cloneElement, forwardRef, isValidElement, type ButtonHTMLAttributes, type MouseEvent, type ReactElement } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'type-action-label inline-flex items-center justify-center gap-2 border rounded-none transition-[background-color,border-color,color,box-shadow,transform] duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none active:scale-[0.99]',
  {
    variants: {
      variant: {
        default: 'border-primary/90 bg-primary text-primary-foreground shadow-token-md hover:-translate-y-px hover:bg-primary/92 hover:shadow-token-lg',
        secondary: 'border-border/80 bg-secondary/80 text-secondary-foreground hover:border-border hover:bg-card',
        outline: 'border-border/80 bg-background text-foreground hover:border-foreground/30 hover:bg-card',
        ghost: 'border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-accent/60 hover:text-foreground',
        destructive: 'border-transparent bg-[var(--destructive)] text-primary-foreground hover:-translate-y-px hover:opacity-94',
        ghostGlass: 'border-border/70 bg-background text-foreground hover:border-foreground/20 hover:bg-card',
      },
      size: {
        default: 'min-h-10 px-4 py-2.5',
        sm: 'min-h-9 px-3.5 py-2',
        lg: 'min-h-11 px-5 py-3',
        icon: 'size-10 px-0',
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
    className="size-4 animate-spin"
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
