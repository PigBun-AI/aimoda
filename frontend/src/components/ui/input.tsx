import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'type-ui-body-md flex min-h-10 w-full rounded-none border border-input/90 bg-card px-3.5 py-2.5 text-foreground shadow-token-sm transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/86 hover:border-foreground/22 hover:bg-card focus:border-foreground/30 focus:outline-none focus:ring-0 focus:shadow-token-md disabled:cursor-not-allowed disabled:opacity-50',
      error && 'border-foreground focus:border-foreground',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
