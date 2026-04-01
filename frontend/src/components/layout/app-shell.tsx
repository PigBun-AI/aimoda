import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Globe,
  History,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageCircle,
  Moon,
  PanelLeftClose,
  PencilLine,
  Pin,
  PinOff,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSessionStore } from '@/features/chat/session-store'
import { useLoginDialog } from '@/features/auth/auth-store'
import { LoginDialog } from '@/features/auth/login-dialog'

import { getSessionUser } from '@/features/auth/protected-route'
import { BREAKPOINT_PX } from '@/lib/constants'
import { cn } from '@/lib/utils'

const SIDEBAR_WIDTH = 250

type SessionDialogState = {
  sessionId: string
  title: string
}

export function AppShell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const currentUser = getSessionUser()
  const currentUserId = currentUser?.id ?? null
  const currentRouteSessionId = useMemo(
    () => new URLSearchParams(location.search).get('session'),
    [location.search],
  )

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isLargeScreen, setIsLargeScreen] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(true)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [renameDialog, setRenameDialog] = useState<SessionDialogState | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<SessionDialogState | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { openLogin } = useLoginDialog()

  const {
    sessions: chatSessions,
    notifications,
    isLoading: sessionsLoading,
    loadSessions: loadChatSessions,
    removeSession: handleRemoveSession,
    renameSession: handleRenameSession,
    toggleSessionPinned,
    dismissSessionNotification,
    resetSessionStore,
    newSession: createNewSession,
  } = useSessionStore()

  const isFloating = !isSidebarOpen && isHovering && isLargeScreen
  const isFullScreenRoute =
    location.pathname === '/' ||
    location.pathname === '/chat' ||
    location.pathname.startsWith('/reports/')

  const hasRunningSession = chatSessions.some(session => session.execution_status === 'running')

  useEffect(() => {
    if (notifications.length === 0) return

    const timers = notifications.map(item => window.setTimeout(() => {
      dismissSessionNotification(item.id)
    }, 5000))

    return () => {
      timers.forEach(timer => window.clearTimeout(timer))
    }
  }, [dismissSessionNotification, notifications])

  const navigation = [
    { to: '/chat', label: t('common:aiAssistant'), icon: MessageCircle },
    { to: '/reports', label: t('reports:title'), icon: LayoutDashboard },
    { to: '/inspiration', label: t('common:inspiration', '灵感情报站'), icon: Sparkles },
  ]

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const checkScreenSize = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const isLarge = window.innerWidth >= BREAKPOINT_PX.lg
        setIsLargeScreen(prev => {
          if (prev !== isLarge) {
            setIsSidebarOpen(isLarge)
          }
          return isLarge
        })
      }, 100)
    }

    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => {
      window.removeEventListener('resize', checkScreenSize)
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [])

  useEffect(() => {
    if (!currentUserId) {
      resetSessionStore()
    }
  }, [currentUserId, resetSessionStore])

  useEffect(() => {
    if (!currentUserId) return
    loadChatSessions()

    const interval = window.setInterval(() => {
      loadChatSessions()
    }, hasRunningSession ? 4000 : 15000)

    return () => window.clearInterval(interval)
  }, [currentUserId, hasRunningSession, loadChatSessions])

  const toggleTheme = useCallback(() => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }, [isDark])

  const toggleLanguage = useCallback(() => {
    const next = i18n.language === 'zh-CN' ? 'en' : 'zh-CN'
    i18n.changeLanguage(next)
  }, [i18n])

  const sidebarWidth = isLargeScreen && isSidebarOpen ? SIDEBAR_WIDTH : 0

  const closeSidebarChrome = useCallback(() => {
    if (isFloating) setIsHovering(false)
    if (!isLargeScreen) setIsSidebarOpen(false)
  }, [isFloating, isLargeScreen])

  const handleProtectedNavigate = useCallback((to: string) => {
    if (!currentUser) {
      navigate('/', { replace: location.pathname !== '/' })
      openLogin()
      closeSidebarChrome()
      return
    }
    navigate(to)
    closeSidebarChrome()
  }, [closeSidebarChrome, currentUser, location.pathname, navigate, openLogin])

  const handleCreateSession = useCallback(async () => {
    if (!currentUser) {
      navigate('/', { replace: location.pathname !== '/' })
      openLogin()
      closeSidebarChrome()
      return
    }
    const newSession = await createNewSession()
    closeSidebarChrome()
    if (newSession) {
      navigate(`/chat?session=${newSession.id}`)
    } else {
      navigate('/chat')
    }
  }, [closeSidebarChrome, createNewSession, currentUser, location.pathname, navigate, openLogin])

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteDialog) return

    setIsDeleting(true)
    const result = await handleRemoveSession(deleteDialog.sessionId)
    const deletingCurrentRoute =
      location.pathname === '/chat' && currentRouteSessionId === deleteDialog.sessionId
    setIsDeleting(false)
    setDeleteDialog(null)

    if (!result || !deletingCurrentRoute) return

    if (result.nextActiveSessionId) {
      navigate(`/chat?session=${result.nextActiveSessionId}`, { replace: true })
    } else {
      navigate('/chat', { replace: true })
    }
  }, [currentRouteSessionId, deleteDialog, handleRemoveSession, location.pathname, navigate])

  const handleRenameConfirmed = useCallback(async () => {
    if (!renameDialog) return
    const title = renameValue.trim()
    if (!title) return

    setIsRenaming(true)
    const updated = await handleRenameSession(renameDialog.sessionId, title)
    setIsRenaming(false)
    if (!updated) return

    setRenameDialog(null)
    setRenameValue('')
  }, [handleRenameSession, renameDialog, renameValue])

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between px-5 h-14 shrink-0">
        <Link className="flex items-center transition-transform duration-fast hover:scale-[1.02]" to="/">
          <img src="/aimoda-logo.svg" alt="aimoda" className="dark:hidden h-[22px]" />
          <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden dark:block h-[22px]" />
        </Link>

        <div className="flex items-center gap-0.5">
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-md transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
            title={isDark ? t('common:switchLight') : t('common:switchDark')}
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <button
            onClick={toggleLanguage}
            className="p-2.5 rounded-md transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
            title={i18n.language === 'zh-CN' ? t('common:switchToEn') : t('common:switchToZh')}
          >
            <Globe size={15} />
          </button>

          {!isFloating && isLargeScreen && (
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-2.5 rounded-md transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <PanelLeftClose size={15} />
            </button>
          )}

          {isFloating && (
            <button
              onClick={() => setIsHovering(false)}
              className="p-2.5 rounded-md transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
              title={t('common:close')}
            >
              <PanelLeftClose size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center mt-4 px-4">
        <Button className="w-full h-11 rounded-full cursor-pointer" onClick={handleCreateSession}>
          <MessageCircle className="w-4 h-4 mr-1.5" />
          <span className="text-sm font-medium">{t('common:fashionSearch')}</span>
        </Button>
      </div>

      <nav className="mt-6 space-y-0.5 px-3">
        {navigation.map(item => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  'group flex items-center gap-3 px-4 py-3 text-sm rounded-lg',
                  'transition-all duration-fast cursor-pointer',
                  isActive
                    ? 'font-medium bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                ].join(' ')
              }
              onClick={event => {
                event.preventDefault()
                handleProtectedNavigate(item.to)
              }}
            >
              <Icon className="w-[18px] h-[18px] shrink-0 group-hover:scale-110 transition-transform" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="px-4 mt-4"><Separator /></div>

      <div className="px-5 py-3 overflow-y-auto flex-1 min-h-0">
        <button
          className="flex items-center gap-2 text-sm font-medium cursor-pointer w-full text-muted-foreground"
          onClick={() => setHistoryExpanded(value => !value)}
        >
          {historyExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <History size={16} />
          <span>{t('common:chatHistory')}</span>
          {hasRunningSession && (
            <Badge variant="warning" size="sm" className="ml-auto">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              {t('common:running')}
            </Badge>
          )}
        </button>

        {historyExpanded && (
          <div className="mt-2 space-y-1">
            {sessionsLoading ? (
              <div className="py-2 text-sm text-center text-muted-foreground">{t('common:loading')}</div>
            ) : chatSessions.length === 0 ? (
              <div className="py-2 text-sm text-center text-muted-foreground">
                {t('common:noChatHistory')}
              </div>
            ) : (
              chatSessions.map(session => {
                const isActive =
                  location.pathname === '/chat' && currentRouteSessionId === session.id

                return (
                  <div
                    key={session.id}
                    className={cn(
                      'group rounded-xl border px-3 py-2.5 transition-colors cursor-pointer',
                      isActive
                        ? 'bg-accent border-border text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-accent/70 hover:border-border',
                    )}
                    onClick={() => handleProtectedNavigate(`/chat?session=${session.id}`)}
                  >
                    <div className="flex items-start gap-2">
                      <MessageCircle className="mt-0.5 w-3.5 h-3.5 shrink-0 opacity-50" />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-sm font-medium">{session.title}</span>
                          {session.is_pinned && (
                            <Pin className="h-3.5 w-3.5 shrink-0 text-foreground/70" />
                          )}
                        </div>

                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          {session.execution_status === 'running' && (
                            <Badge variant="warning" size="sm">
                              <LoaderCircle className="h-3 w-3 animate-spin" />
                              {t('common:running')}
                            </Badge>
                          )}
                          {session.execution_status === 'error' && (
                            <Badge variant="error" size="sm">
                              <AlertTriangle className="h-3 w-3" />
                              {t('common:failed')}
                            </Badge>
                          )}
                          <span className="text-[11px] text-muted-foreground/90">
                            {new Date(session.updated_at).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 transition-opacity md:group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          className="p-1.5 rounded-md hover:bg-background/80 transition-colors"
                          onClick={async event => {
                            event.stopPropagation()
                            await toggleSessionPinned(session.id, !session.is_pinned)
                          }}
                          title={session.is_pinned ? t('common:unpin') : t('common:pin')}
                        >
                          {session.is_pinned ? <PinOff size={13} /> : <Pin size={13} />}
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-background/80 transition-colors"
                          onClick={event => {
                            event.stopPropagation()
                            setRenameDialog({ sessionId: session.id, title: session.title })
                            setRenameValue(session.title)
                          }}
                          title={t('common:rename')}
                        >
                          <PencilLine size={13} />
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
                          onClick={event => {
                            event.stopPropagation()
                            setDeleteDialog({ sessionId: session.id, title: session.title })
                          }}
                          title={t('common:delete')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      <div className="mt-auto shrink-0">
        <div className="px-4"><Separator /></div>

        <div className="p-4">
          {currentUser ? (
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 mt-3 px-2 py-2 rounded-lg transition-colors cursor-pointer',
                  isActive ? 'bg-accent' : '',
                ].join(' ')
              }
              onClick={() => {
                if (isFloating) setIsHovering(false)
                if (!isLargeScreen) setIsSidebarOpen(false)
              }}
            >
              <CircleUserRound className="w-5 h-5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-foreground">
                  {currentUser.name ?? t('common:user')}
                </p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {currentUser.role ?? 'guest'}
                </p>
              </div>
            </NavLink>
          ) : (
            <Button
              onClick={openLogin}
              className="w-full h-12 rounded-lg cursor-pointer flex flex-col gap-0.5"
            >
              <div className="flex items-center gap-1.5">
                <CircleUserRound className="w-4 h-4" />
                <span className="text-sm font-bold">{t('common:login')}</span>
              </div>
              <span className="text-xs font-normal opacity-70">{t('common:startJourney')}</span>
            </Button>
          )}
        </div>
      </div>
    </>
  )

  return (
    <div className="min-h-dvh bg-background">
      <LoginDialog />

      <Dialog open={Boolean(renameDialog)} onOpenChange={open => !open && setRenameDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common:renameSession')}</DialogTitle>
            <DialogDescription>{t('common:renameSessionHint')}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={event => setRenameValue(event.target.value)}
            placeholder={t('common:sessionName')}
            maxLength={80}
            autoFocus
            onKeyDown={event => {
              if (event.key === 'Enter' && renameValue.trim()) {
                void handleRenameConfirmed()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog(null)}>
              {t('common:cancel')}
            </Button>
            <Button loading={isRenaming} onClick={() => void handleRenameConfirmed()} disabled={!renameValue.trim()}>
              {t('common:save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteDialog)} onOpenChange={open => !open && setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common:confirmDeleteSession')}</DialogTitle>
            <DialogDescription>
              {deleteDialog ? t('common:confirmDeleteSessionHint', { title: deleteDialog.title }) : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>
              {t('common:cancel')}
            </Button>
            <Button variant="destructive" loading={isDeleting} onClick={() => void handleDeleteConfirmed()}>
              {t('common:delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {notifications.length > 0 && (
        <div className="fixed right-4 top-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
          {notifications.slice(0, 4).map(item => {
            const Icon = item.kind === 'completed' ? CheckCircle2 : BellRing
            const iconClassName = item.kind === 'completed' ? 'text-emerald-500' : 'text-amber-500'

            return (
              <div
                key={item.id}
                className="w-full rounded-2xl border bg-background/96 p-4 text-left shadow-xl backdrop-blur"
              >
                <div className="flex items-start gap-3">
                  <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconClassName)} />
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      dismissSessionNotification(item.id)
                      handleProtectedNavigate(`/chat?session=${item.sessionId}`)
                    }}
                  >
                    <div className="text-sm font-semibold text-foreground">{item.title}</div>
                    <div className="mt-1 text-sm leading-5 text-muted-foreground">{item.message}</div>
                  </button>
                  <button
                    className="rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:opacity-100"
                    onClick={() => {
                      dismissSessionNotification(item.id)
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {isSidebarOpen && !isLargeScreen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-normal"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {!isSidebarOpen && isLargeScreen && (
        <div
          className="fixed top-2 left-0 w-4 z-50"
          style={{ height: 'calc(100% - 56px)' }}
          onMouseEnter={() => setIsHovering(true)}
        />
      )}

      {isFloating && (
        <>
          <div
            className="fixed top-2 left-2 z-50 overflow-hidden flex flex-col bg-background border border-border rounded-xl shadow-xl"
            style={{
              width: `${SIDEBAR_WIDTH}px`,
              maxHeight: 'calc(100dvh - 16px)',
            }}
          >
            <div className="overflow-y-auto flex flex-col h-full">
              {sidebarContent}
            </div>
          </div>
          <div
            className="fixed inset-0 z-40"
            onMouseEnter={() => setIsHovering(false)}
            onClick={() => setIsHovering(false)}
          />
        </>
      )}

      {!isFloating && (
        <aside
          className="fixed left-0 top-0 z-50 h-dvh flex flex-col transition-transform duration-normal ease-out bg-secondary border-r border-border"
          style={{
            width: `${SIDEBAR_WIDTH}px`,
            transform: isSidebarOpen ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`,
            pointerEvents: isSidebarOpen ? 'auto' : 'none',
          }}
        >
          {sidebarContent}
        </aside>
      )}

      {!isLargeScreen && isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(false)}
          className="fixed top-4 z-[60] cursor-pointer"
          style={{ left: `${SIDEBAR_WIDTH + 16}px` }}
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      )}

      <main
        className="min-h-dvh transition-all duration-normal ease-out"
        style={{ marginLeft: isLargeScreen ? `${sidebarWidth}px` : 0 }}
      >
        <header className="lg:hidden sticky top-0 z-30 flex items-center h-14 px-4 border-b border-border bg-background">
          <div className="w-10 flex justify-start">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-2 rounded-lg cursor-pointer active:bg-accent transition-colors"
              aria-label={t('common:openMenu')}
            >
              <Menu className="w-5 h-5 text-foreground" />
            </button>
          </div>

          <div className="flex-1 flex justify-center">
            <Link to="/">
              <img src="/aimoda-logo.svg" alt="aimoda" className="dark:hidden h-[18px]" />
              <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden dark:block h-[18px]" />
            </Link>
          </div>

          <div className="w-10 flex justify-end items-center gap-0.5">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md cursor-pointer text-muted-foreground hover:text-foreground active:bg-accent transition-colors"
              aria-label={isDark ? t('common:switchLight') : t('common:switchDark')}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={toggleLanguage}
              className="p-2 -mr-2 rounded-md cursor-pointer text-muted-foreground hover:text-foreground active:bg-accent transition-colors"
              aria-label={i18n.language === 'zh-CN' ? t('common:switchToEn') : t('common:switchToZh')}
            >
              <Globe size={16} />
            </button>
          </div>
        </header>

        {isLargeScreen && !isSidebarOpen && (
          <div className="fixed top-3 left-3 z-30">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSidebarOpen(true)}
              className="h-8 w-8 p-0 cursor-pointer bg-accent border border-border"
            >
              <Menu className="w-4 h-4 text-muted-foreground" />
            </Button>
          </div>
        )}

        {isFullScreenRoute ? (
          <div className="h-[calc(100dvh-56px)] lg:h-dvh">
            <Outlet />
          </div>
        ) : (
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="max-w-6xl mx-auto">
              <Outlet />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
