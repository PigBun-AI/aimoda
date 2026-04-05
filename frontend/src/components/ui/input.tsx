import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex min-h-11 w-full rounded-[var(--radius-sm)] border border-input bg-background px-3 py-3 text-sm leading-[1.45] text-foreground transition-colors placeholder:text-muted-foreground/90 hover:border-foreground/50 focus:border-foreground focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
      error && 'border-foreground focus:border-foreground',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
