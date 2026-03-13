import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      [
        'flex h-10 w-full',
        'rounded-[var(--radius-sm)]',
        'bg-[var(--bg-secondary)]',
        'border border-[var(--border-color)]',
        'px-3 py-2',
        'text-sm text-[var(--text-primary)]',
        'shadow-[var(--shadow-xs)]',
        'transition-all duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
        'placeholder:text-[var(--text-muted)]',
        'hover:border-[var(--text-muted)]',
        'focus:outline-none focus:border-[var(--text-secondary)] focus:ring-2 focus:ring-[var(--gold-muted)] focus:bg-[var(--bg-primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--bg-tertiary)]',
        error && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
      ].join(' '),
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }