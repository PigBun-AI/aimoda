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
import { useChatLayoutStore } from '@/features/chat/chat-layout-store'
import { useLoginDialog } from '@/features/auth/auth-store'
import { LoginDialog } from '@/features/auth/login-dialog'
import { useMembershipStatus } from '@/features/membership/use-membership'

import { getSessionUser } from '@/features/auth/protected-route'
import { BREAKPOINT_PX } from '@/lib/constants'
import { useThemeStore } from '@/lib/theme-store'
import { cn } from '@/lib/utils'

const SIDEBAR_WIDTH = 250
const SIDEBAR_ICON_BUTTON_CLASS =
  'control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors cursor-pointer hover:border-border hover:text-foreground'
const SIDEBAR_UTILITY_BUTTON_CLASS =
  'type-action-label control-pill-md flex items-center justify-between gap-3 border border-border text-muted-foreground transition-colors cursor-pointer hover:border-foreground/35 hover:bg-accent hover:text-foreground'

function formatSidebarSessionTimestamp(value: string, language: string) {
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US'
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  const datePart = new Intl.DateTimeFormat(locale, {
    month: language === 'zh-CN' ? '2-digit' : 'short',
    day: '2-digit',
  }).format(date)

  const timePart = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: language !== 'zh-CN',
  }).format(date)

  return `${datePart} · ${timePart}`
}

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
  const [renameDialog, setRenameDialog] = useState<SessionDialogState | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<SessionDialogState | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { isDrawerFullscreen } = useChatLayoutStore()
  const { openLogin } = useLoginDialog()
  const { theme, toggleTheme } = useThemeStore()

  const {
    sessions: chatSessions,
    notifications,
    isLoading: sessionsLoading,
    loadSessions: loadChatSessions,
    setActiveSessionId,
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
  const isChatImmersive = location.pathname === '/chat' && isDrawerFullscreen

  const hasRunningSession = chatSessions.some(session => session.execution_status === 'running')
  const { planBadgeLabel } = useMembershipStatus()

  useEffect(() => {
    if (notifications.length === 0) return

    const timers = notifications.map(item => window.setTimeout(() => {
      dismissSessionNotification(item.id)
    }, 5000))

    return () => {
      timers.forEach(timer => window.clearTimeout(timer))
    }
  }, [dismissSessionNotification, notifications])

  const navigation = useMemo(
    () => [
      { to: '/chat', label: t('common:aiAssistant'), icon: MessageCircle },
      { to: '/reports', label: t('reports:title'), icon: LayoutDashboard },
      { to: '/inspiration', label: t('common:inspiration'), icon: Sparkles },
    ],
    [t],
  )

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

  const toggleLanguage = useCallback(() => {
    const next = i18n.language === 'zh-CN' ? 'en' : 'zh-CN'
    i18n.changeLanguage(next)
  }, [i18n])

  const sidebarWidth = isLargeScreen && isSidebarOpen && !isChatImmersive ? SIDEBAR_WIDTH : 0
  const currentLanguageLabel = i18n.language === 'zh-CN' ? '中文' : 'EN'
  const currentThemeLabel = theme === 'dark' ? t('common:themeDark') : t('common:themeLight')

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

    setActiveSessionId(null)
    navigate('/chat', { replace: location.pathname === '/chat' })

    const newSession = await createNewSession()
    closeSidebarChrome()
    if (newSession) {
      navigate(`/chat?session=${newSession.id}`)
    } else {
      navigate('/chat')
    }
  }, [closeSidebarChrome, createNewSession, currentUser, location.pathname, navigate, openLogin, setActiveSessionId])

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
      <div className="shrink-0 border-b border-border px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <Link className="flex items-center transition-opacity duration-fast hover:opacity-70" to="/">
            <img src="/aimoda-logo.svg" alt="aimoda" className="dark:hidden h-[22px]" />
            <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden dark:block h-[22px]" />
          </Link>

          <div className="flex items-center gap-1">
            {!isFloating && isLargeScreen && (
              <button
                onClick={() => setIsSidebarOpen(false)}
                className={SIDEBAR_ICON_BUTTON_CLASS}
              >
                <PanelLeftClose size={15} />
              </button>
            )}

            {isFloating && (
              <button
                onClick={() => setIsHovering(false)}
                className={SIDEBAR_ICON_BUTTON_CLASS}
                title={t('common:close')}
              >
                <PanelLeftClose size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3 px-4">
        <Button className="h-11 w-full cursor-pointer justify-between px-4" onClick={handleCreateSession}>
          <span>{t('common:fashionSearch')}</span>
          <MessageCircle className="h-4 w-4" />
        </Button>
      </div>

      <nav className="mt-6 space-y-2 px-4">
        {navigation.map(item => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  'type-ui-label-sm group flex items-center justify-between gap-3 border px-4 py-3',
                  'transition-colors duration-fast cursor-pointer',
                  isActive
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground',
                ].join(' ')
              }
              onClick={event => {
                event.preventDefault()
                handleProtectedNavigate(item.to)
              }}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-[16px] w-[16px] shrink-0" />
                <div className="flex flex-col gap-1">
                  <span>{item.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-55" />
              </div>
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-5 px-4"><Separator /></div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <button
          className="type-ui-label-xs flex w-full items-center gap-2 text-muted-foreground cursor-pointer"
          onClick={() => setHistoryExpanded(value => !value)}
        >
          {historyExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <History size={15} />
          <span>{t('common:chatHistory')}</span>
          {hasRunningSession && (
            <Badge variant="warning" size="sm" className="ml-auto">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              {t('common:running')}
            </Badge>
          )}
        </button>

        {historyExpanded && (
          <div className="mt-4 space-y-2">
            {sessionsLoading ? (
              <div className="type-ui-label-xs border border-border px-4 py-4 text-center text-muted-foreground">{t('common:loading')}</div>
            ) : chatSessions.length === 0 ? (
              <div className="type-ui-label-xs border border-border px-4 py-4 text-center text-muted-foreground">
                {t('common:noChatHistory')}
              </div>
            ) : (
              chatSessions.map(session => {
                const isActive =
                  location.pathname === '/chat' && currentRouteSessionId === session.id
                const metaTimestamp = formatSidebarSessionTimestamp(session.updated_at, i18n.language)

                return (
                  <div
                    key={session.id}
                    className={cn(
                      'group border px-3 py-3 transition-colors cursor-pointer',
                      isActive
                        ? 'border-foreground bg-accent text-foreground'
                        : 'border-border/70 text-muted-foreground hover:border-border hover:bg-accent/55',
                    )}
                    onClick={() => handleProtectedNavigate(`/chat?session=${session.id}`)}
                  >
                    <div className="flex items-start gap-2.5">
                      <MessageCircle className="mt-[2px] h-3.5 w-3.5 shrink-0 opacity-45" />

                      <div className="min-w-0 flex-1">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="type-ui-body-sm truncate text-foreground">
                                {session.title}
                              </span>
                              {session.is_pinned && (
                                <Pin className="h-3.5 w-3.5 shrink-0 text-foreground/65" />
                              )}
                            </div>

                            <div className="type-ui-meta mt-1 flex min-w-0 items-center gap-2 whitespace-nowrap text-muted-foreground/88">
                              {session.execution_status === 'running' && (
                                <span className="inline-flex items-center gap-1 text-foreground/78">
                                  <LoaderCircle className="h-3 w-3 animate-spin" />
                                  <span>{t('common:running')}</span>
                                </span>
                              )}
                              {session.execution_status === 'error' && (
                                <span className="inline-flex items-center gap-1 text-[var(--badge-error-text)]">
                                  <AlertTriangle className="h-3 w-3" />
                                  <span>{t('common:failed')}</span>
                                </span>
                              )}
                              <span className="truncate">{metaTimestamp}</span>
                            </div>
                          </div>

                          <div
                            className={cn(
                              'flex items-center justify-end gap-0.5 overflow-hidden transition-[width,opacity] duration-fast w-[84px] opacity-100',
                              isActive
                                ? 'md:w-[84px] md:opacity-100'
                                : 'md:w-0 md:opacity-0 md:group-hover:w-[84px] md:group-hover:opacity-100 md:group-focus-within:w-[84px] md:group-focus-within:opacity-100',
                            )}
                          >
                            <button
                              className="flex h-7 w-7 items-center justify-center border border-transparent transition-colors hover:border-border hover:bg-background/80"
                              onClick={async event => {
                                event.stopPropagation()
                                await toggleSessionPinned(session.id, !session.is_pinned)
                              }}
                              title={session.is_pinned ? t('common:unpin') : t('common:pin')}
                            >
                              {session.is_pinned ? <PinOff size={13} /> : <Pin size={13} />}
                            </button>
                            <button
                              className="flex h-7 w-7 items-center justify-center border border-transparent transition-colors hover:border-border hover:bg-background/80"
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
                              className="flex h-7 w-7 items-center justify-center border border-transparent transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
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

        <div className="px-4 py-4">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              onClick={toggleTheme}
              className={cn(SIDEBAR_UTILITY_BUTTON_CLASS, 'justify-center')}
              title={theme === 'dark' ? t('common:switchLight') : t('common:switchDark')}
            >
              <span className="flex items-center gap-2">
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                <span>{currentThemeLabel}</span>
              </span>
            </button>

            <button
              onClick={toggleLanguage}
              className={cn(SIDEBAR_UTILITY_BUTTON_CLASS, 'justify-center')}
              title={i18n.language === 'zh-CN' ? t('common:switchToEn') : t('common:switchToZh')}
            >
              <span className="flex items-center gap-2">
                <Globe size={14} />
                <span>{currentLanguageLabel}</span>
              </span>
            </button>
          </div>

          {currentUser ? (
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                [
                  'mt-3 flex items-center gap-3 border px-4 py-3 transition-colors cursor-pointer',
                  isActive ? 'border-foreground bg-accent' : 'border-border hover:border-foreground/50',
                ].join(' ')
              }
              onClick={() => {
                if (isFloating) setIsHovering(false)
                if (!isLargeScreen) setIsSidebarOpen(false)
              }}
            >
              <CircleUserRound className="w-5 h-5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="type-ui-body-sm truncate text-foreground">
                    {currentUser.name ?? t('common:user')}
                  </p>
                  <span className="type-ui-label-xs shrink-0 border border-border px-1.5 py-0.5 text-muted-foreground">
                    {planBadgeLabel}
                  </span>
                </div>
                <p className="type-ui-label-sm text-muted-foreground">
                  {currentUser.role ?? 'guest'}
                </p>
              </div>
            </NavLink>
          ) : (
            <Button
              onClick={openLogin}
              className="flex h-12 w-full cursor-pointer items-center justify-between px-4"
            >
              <div className="flex items-center gap-1.5">
                <CircleUserRound className="w-4 h-4" />
                <span>{t('common:login')}</span>
              </div>
              <span className="type-caption opacity-70">{t('common:startJourney')}</span>
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
            const iconClassName = item.kind === 'completed' ? 'text-foreground' : 'text-muted-foreground'

            return (
              <div
                key={item.id}
                className="w-full border border-border bg-background/96 p-4 text-left shadow-lg backdrop-blur"
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
                    <div className="type-ui-title-sm text-foreground">{item.title}</div>
                    <div className="type-ui-body-sm mt-1 text-muted-foreground">{item.message}</div>
                  </button>
                  <button
                    className="border border-transparent p-1 text-muted-foreground opacity-70 transition-all hover:border-border hover:bg-accent hover:opacity-100"
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

      {isSidebarOpen && !isLargeScreen && !isChatImmersive && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-normal"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {!isSidebarOpen && isLargeScreen && !isChatImmersive && (
        <div
          className="fixed top-2 left-0 w-4 z-50"
          style={{ height: 'calc(100% - 56px)' }}
          onMouseEnter={() => setIsHovering(true)}
        />
      )}

      {isFloating && !isChatImmersive && (
        <>
          <div
            className="fixed top-2 left-2 z-50 flex flex-col overflow-hidden border border-border bg-background shadow-xl"
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

      {!isFloating && !isChatImmersive && (
        <aside
          className="fixed left-0 top-0 z-50 flex h-dvh flex-col border-r border-border bg-secondary transition-transform duration-normal ease-out"
          style={{
            width: `${SIDEBAR_WIDTH}px`,
            transform: isSidebarOpen ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`,
            pointerEvents: isSidebarOpen ? 'auto' : 'none',
          }}
        >
          {sidebarContent}
        </aside>
      )}

      {!isLargeScreen && isSidebarOpen && !isChatImmersive && (
        <button
          onClick={() => setIsSidebarOpen(false)}
          className="fixed top-4 z-[60] cursor-pointer"
          style={{ left: `min(calc(100vw - 3rem), ${SIDEBAR_WIDTH + 16}px)` }}
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      )}

      <main
        className="min-h-dvh transition-all duration-normal ease-out"
        style={{ marginLeft: isLargeScreen ? `${sidebarWidth}px` : 0 }}
      >
        <header className={cn(
          'sticky top-0 z-30 flex h-14 items-center border-b border-border bg-background px-4 lg:hidden',
          isChatImmersive && 'hidden',
        )}>
          <div className="w-10 flex justify-start">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="-ml-1 control-icon-sm flex items-center justify-center border border-transparent transition-colors cursor-pointer hover:border-border active:bg-accent"
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
              className="control-icon-sm flex items-center justify-center border border-transparent cursor-pointer text-muted-foreground transition-colors hover:border-border hover:text-foreground active:bg-accent"
              aria-label={theme === 'dark' ? t('common:switchLight') : t('common:switchDark')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={toggleLanguage}
              className="-mr-1 control-icon-sm flex items-center justify-center border border-transparent cursor-pointer text-muted-foreground transition-colors hover:border-border hover:text-foreground active:bg-accent"
              aria-label={i18n.language === 'zh-CN' ? t('common:switchToEn') : t('common:switchToZh')}
            >
              <Globe size={16} />
            </button>
          </div>
        </header>

        {isLargeScreen && !isSidebarOpen && !isChatImmersive && (
          <div className="fixed top-3 left-3 z-30">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSidebarOpen(true)}
              className="control-icon-sm cursor-pointer border border-border bg-background p-0"
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
