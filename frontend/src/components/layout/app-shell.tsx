import { useState, useEffect } from 'react'
import { Link, NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BarChart3, FileText, LayoutDashboard, LogOut, Menu, Ticket, UserCog, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { RedeemDialog } from '@/features/redemption/redeem-dialog'
import { useMySubscription } from '@/features/redemption/use-redeem'

import { clearSession, getSessionUser } from '@/features/auth/protected-route'
import { queryClient } from '@/main'

const SIDEBAR_WIDTH = 280
const SIDEBAR_COLLAPSED = 72

export function AppShell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const currentUser = getSessionUser()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isLargeScreen, setIsLargeScreen] = useState(true)
  const { data: subscription } = useMySubscription()

  const navigation = [
    {
      to: '/reports',
      label: t('reports:title'),
      icon: LayoutDashboard,
    },
    {
      to: '/admin',
      label: t('admin:dashboard'),
      icon: BarChart3,
      requiresAdmin: true,
    },
    {
      to: '/admin/articles',
      label: t('admin:articleManagement'),
      icon: FileText,
      requiresAdmin: true,
    },
    {
      to: '/admin/users',
      label: t('admin:userManagement'),
      icon: UserCog,
      requiresAdmin: true,
    },
    {
      to: '/admin/redemption-codes',
      label: t('admin:redemptionCodes'),
      icon: Ticket,
      requiresAdmin: true,
    },
  ]

  // Responsive: detect screen size
  useEffect(() => {
    const checkScreenSize = () => {
      setIsLargeScreen(window.innerWidth >= 1024)
    }
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  // Close sidebar on route change (mobile)
  useEffect(() => {
    if (!isLargeScreen) {
      setIsSidebarOpen(false)
    }
  }, [location.pathname, isLargeScreen])

  function handleLogout() {
    queryClient.clear()
    clearSession()
    navigate('/login', { replace: true })
  }

  const visibleNavigation = navigation.filter((item) => !item.requiresAdmin || currentUser?.role === 'admin')
  const sidebarWidth = isLargeScreen && isSidebarOpen ? SIDEBAR_WIDTH : isLargeScreen && !isSidebarOpen ? SIDEBAR_COLLAPSED : 0

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Mobile overlay */}
      {isSidebarOpen && !isLargeScreen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop: fixed, Mobile: overlay */}
      <aside
        className={`fixed left-0 top-0 z-50 h-screen flex flex-col transition-all duration-300 ease-out ${
          isLargeScreen
            ? isSidebarOpen ? 'w-[280px]' : 'w-[72px]'
            : isSidebarOpen ? 'w-[280px] translate-x-0' : 'w-[280px] -translate-x-full'
        }`}
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div className={`flex items-center h-20 ${isSidebarOpen ? 'px-6' : 'px-4 justify-center'}`}>
          <Link className="flex items-center transition-transform duration-200 hover:scale-[1.02]" to="/reports">
            <img
              src="/WWWD_logo_clean.svg"
              alt="WWWD"
              className="dark:hidden"
              style={{ height: isSidebarOpen ? '56px' : '44px', width: 'auto' }}
            />
            <img
              src="/WWWD_logo_inverted.svg"
              alt="WWWD"
              className="hidden dark:block"
              style={{ height: isSidebarOpen ? '56px' : '44px', width: 'auto' }}
            />
          </Link>
        </div>

        {/* Toggle button - Desktop only */}
        {isLargeScreen && (
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="absolute top-5 flex items-center justify-center w-6 h-6 rounded-full transition-all duration-200 cursor-pointer right-[-12px]"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-sm)',
            }}
            aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {isSidebarOpen ? (
              <X className="h-3 w-3 text-[var(--text-secondary)]" />
            ) : (
              <Menu className="h-3 w-3 text-[var(--text-secondary)]" />
            )}
          </button>
        )}

        {/* Mobile close */}
        {!isLargeScreen && (
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="absolute top-5 right-4 cursor-pointer"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5 text-[var(--text-secondary)]" />
          </button>
        )}

        {/* Navigation */}
        <nav className={`mt-2 space-y-1 flex-1 overflow-y-auto ${isSidebarOpen ? 'px-3' : 'px-2'}`}>
          {visibleNavigation.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                className={({ isActive }) =>
                  [
                    'group flex items-center gap-3 px-4 py-3 text-sm rounded-[var(--radius-sm)]',
                    'transition-all duration-200 ease-out',
                    'cursor-pointer',
                    'min-h-[44px]', // Touch-friendly
                    isActive
                      ? 'font-medium shadow-[var(--shadow-sm)]'
                      : 'hover:bg-[var(--bg-tertiary)] hover:shadow-[var(--shadow-xs)]',
                  ].join(' ')
                }
                style={({ isActive }) => ({
                  backgroundColor: isActive ? 'var(--text-primary)' : 'transparent',
                  color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
                })}
              >
                <Icon className="h-5 w-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
                {isSidebarOpen && <span className="whitespace-nowrap">{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom section */}
        <div className="mt-auto shrink-0">
          <Separator className="mx-3 bg-[var(--border-color)]" />

          <div className={`py-4 ${isSidebarOpen ? 'px-4' : 'px-2 text-center'}`}>
            {/* Subscription status */}
            {isSidebarOpen && (
              <div className="mb-3 px-2">
                {subscription ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    {t('common:subscribedUntil')} {new Date(subscription.endsAt).toLocaleDateString(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US')}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">{t('common:notSubscribed')}</p>
                )}
              </div>
            )}

            {/* Redeem dialog */}
            {isSidebarOpen && <RedeemDialog />}

            {/* User info */}
            <div className="mt-3 space-y-1 px-2">
              <p className="text-sm font-medium truncate text-[var(--text-primary)]">
                {currentUser?.name ?? t('common:notLoggedIn')}
              </p>
              {isSidebarOpen && (
                <p className="text-xs tracking-[0.15em] uppercase text-[var(--text-muted)]">
                  {currentUser?.role ?? 'guest'}
                </p>
              )}
            </div>

            <div className={`mt-3 flex items-center px-2 ${isSidebarOpen ? 'gap-2' : 'flex-col gap-2 items-center'}`}>
              <LanguageSwitcher />
              <ThemeToggle />
              <Button
                className="flex-1 justify-start gap-2 bg-transparent hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] min-h-[44px]"
                variant="ghost"
                onClick={handleLogout}
              >
                <LogOut className="h-5 w-5" />
                {isSidebarOpen && t('common:logout')}
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main
        className="min-h-screen transition-all duration-300 ease-out bg-[var(--bg-primary)]"
        style={{ marginLeft: isLargeScreen ? `${sidebarWidth}px` : 0 }}
      >
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-16 px-4 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 rounded-[var(--radius-sm)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5 text-[var(--text-primary)]" />
          </button>
          <Link to="/reports">
            <img src="/WWWD_logo_clean.svg" alt="WWWD" className="dark:hidden" style={{ height: '40px', width: 'auto' }} />
            <img src="/WWWD_logo_inverted.svg" alt="WWWD" className="hidden dark:block" style={{ height: '40px', width: 'auto' }} />
          </Link>
          <ThemeToggle />
        </header>

        {/* Content area */}
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            <p className="text-xs sm:text-sm mb-4 sm:mb-6 text-[var(--text-muted)] tracking-wide uppercase">
              World Wear Watch Daily
            </p>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}