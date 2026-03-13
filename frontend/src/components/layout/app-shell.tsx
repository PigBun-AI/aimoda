import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BarChart3, LayoutDashboard, LogOut, Menu, Ticket, UserCog, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ThemeToggle } from '@/components/theme-toggle'
import { RedeemDialog } from '@/features/redemption/redeem-dialog'
import { useMySubscription } from '@/features/redemption/use-redeem'

import { clearSession, getSessionUser } from '@/features/auth/protected-route'

const SIDEBAR_WIDTH = 280
const SIDEBAR_COLLAPSED = 72

const navigation = [
  {
    to: '/reports',
    label: '趋势文章',
    icon: LayoutDashboard,
  },
  {
    to: '/admin',
    label: '数据看板',
    icon: BarChart3,
    requiresAdmin: true,
  },
  {
    to: '/admin/users',
    label: '用户管理',
    icon: UserCog,
    requiresAdmin: true,
  },
  {
    to: '/admin/redemption-codes',
    label: '兑换码',
    icon: Ticket,
    requiresAdmin: true,
  },
]

export function AppShell() {
  const navigate = useNavigate()
  const currentUser = getSessionUser()
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const { data: subscription } = useMySubscription()

  function handleLogout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  const visibleNavigation = navigation.filter((item) => !item.requiresAdmin || currentUser?.role === 'admin')
  const sidebarWidth = isSidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 h-screen flex flex-col sidebar-transition ${
          isSidebarOpen ? 'w-[280px]' : 'w-[72px]'
        }`}
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
        }}
      >
        {/* Header */}
        <div className={`flex items-center ${isSidebarOpen ? 'px-6 py-6' : 'px-4 py-6 justify-center'}`}>
          <Link className="flex items-center" to="/reports">
            <img
              src="/WWWD_logo_clean.svg"
              alt="WWWD"
              className="dark:hidden"
              style={{ height: isSidebarOpen ? '40px' : '36px', width: 'auto' }}
            />
            <img
              src="/WWWD_logo_inverted.svg"
              alt="WWWD"
              className="hidden dark:block"
              style={{ height: isSidebarOpen ? '40px' : '36px', width: 'auto' }}
            />
          </Link>
        </div>

        {/* Toggle button */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`absolute top-6 hidden lg:flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
            isSidebarOpen ? 'right-[-12px]' : 'right-[-12px]'
          }`}
          style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
          aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isSidebarOpen ? (
            <X className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
          ) : (
            <Menu className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
          )}
        </button>

        {/* Mobile close */}
        <button
          onClick={() => setIsSidebarOpen(false)}
          className="absolute top-6 right-4 lg:hidden"
          aria-label="Close sidebar"
        >
          <X className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
        </button>

        {/* Navigation - flex-1 to push user info to bottom */}
        <nav className={`mt-4 space-y-1 flex-1 ${isSidebarOpen ? 'px-3' : 'px-2'}`}>
          {visibleNavigation.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 px-4 py-2.5 text-sm rounded-md transition-all duration-200',
                    isActive
                      ? 'font-medium'
                      : '',
                  ].join(' ')
                }
                style={({ isActive }) => ({
                  backgroundColor: isActive ? 'var(--text-primary)' : 'transparent',
                  color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
                })}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {isSidebarOpen && <span className="whitespace-nowrap">{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom section */}
        <div className="mt-auto">
          <Separator className="mx-3" style={{ backgroundColor: 'var(--border-color)' }} />

          <div className={`py-4 ${isSidebarOpen ? 'px-6' : 'px-2 text-center'}`}>
            {/* Subscription status */}
            {isSidebarOpen && (
              <div className="mb-3">
                {subscription ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    订阅至 {new Date(subscription.endsAt).toLocaleDateString('zh-CN')}
                  </p>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>未订阅</p>
                )}
              </div>
            )}

            {/* Redeem dialog */}
            {isSidebarOpen && <RedeemDialog />}

            {/* User info */}
            <div className="mt-3 space-y-1">
              <p
                className="text-sm font-medium truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {currentUser?.name ?? '未登录'}
              </p>
              {isSidebarOpen && (
                <p
                  className="text-xs tracking-[0.15em] uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {currentUser?.role ?? 'guest'}
                </p>
              )}
            </div>

            <div className={`mt-3 flex items-center ${isSidebarOpen ? 'gap-2' : 'flex-col gap-2 items-center'}`}>
              <ThemeToggle />
              <Button
                className="flex-1 justify-start gap-2 bg-transparent hover:bg-[var(--bg-tertiary)]"
                variant="ghost"
                onClick={handleLogout}
                style={{ color: 'var(--text-muted)' }}
              >
                <LogOut className="h-4 w-4" />
                {isSidebarOpen && '退出登录'}
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div
        className="transition-all duration-300"
        style={{ marginLeft: `${sidebarWidth}px` }}
      >
        {/* Mobile header */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-4 border-b"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-primary)' }}
        >
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
          >
            <Menu className="h-5 w-5" style={{ color: 'var(--text-primary)' }} />
          </button>
          <span>
            <img src="/WWWD_logo_clean.svg" alt="WWWD" className="dark:hidden" style={{ height: '28px', width: 'auto' }} />
            <img src="/WWWD_logo_inverted.svg" alt="WWWD" className="hidden dark:block" style={{ height: '28px', width: 'auto' }} />
          </span>
          <ThemeToggle />
        </header>

        <main className="p-6 lg:p-8" style={{ backgroundColor: 'var(--bg-primary)' }}>
          <div className="max-w-6xl">
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              World Wear Watch Daily
            </p>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
