import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex min-h-11 w-full rounded-none border border-input/90 bg-card px-4 py-3 text-[0.9375rem] leading-[1.52] tracking-[-0.01em] text-foreground shadow-token-sm transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/86 hover:border-foreground/22 hover:bg-card focus:border-foreground/30 focus:outline-none focus:ring-0 focus:shadow-token-md disabled:cursor-not-allowed disabled:opacity-50',
      error && 'border-foreground focus:border-foreground',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
