import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-md bg-background border border-input px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground hover:border-muted-foreground focus:outline-none focus:border-foreground focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50',
      error && 'border-destructive focus:border-destructive focus:ring-destructive/20',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }