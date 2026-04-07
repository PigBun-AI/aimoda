import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex min-h-11 w-full rounded-none border border-input bg-background px-4 py-3 text-[0.84375rem] leading-[1.52] tracking-[0.006em] text-foreground transition-colors placeholder:text-muted-foreground/90 hover:border-foreground/50 focus:border-foreground focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
      error && 'border-foreground focus:border-foreground',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
