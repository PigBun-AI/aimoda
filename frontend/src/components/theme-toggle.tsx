import { Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useThemeStore } from '@/lib/theme-store'

export function useTheme() {
  return useThemeStore()
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn('inline-flex size-10 items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent/30 hover:text-foreground', className)}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? (
        <Moon className="size-4" />
      ) : (
        <Sun className="size-4" />
      )}
    </button>
  )
}
