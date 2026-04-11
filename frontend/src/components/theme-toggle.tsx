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
      onClick={toggleTheme}
      className={cn('border border-transparent p-2 transition-colors hover:border-border hover:bg-accent/30', className)}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? (
        <Moon className="h-4 w-4 text-muted-foreground" />
      ) : (
        <Sun className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  )
}
