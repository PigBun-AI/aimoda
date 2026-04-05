import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ChatInput } from './chat-input'
import { ImageDrawer } from './image-drawer'
import { MessageBubble } from './message-bubble'
import type { ChatComposerInput } from './chat-types'
import { useChat } from './chat-hooks'
import { useChatLayoutStore } from './chat-layout-store'
import { deriveSessionTitleFromBlocks } from './session-title'
import { useSessionStore } from './session-store'
import { useMembershipStatus } from '@/features/membership/use-membership'
import { cn } from '@/lib/utils'
import { useIsDesktop } from '@/lib/use-breakpoint'

function LoadingIndicator() {
  const { t } = useTranslation('common')

  return (
    <div className="animate-in fade-in flex items-center gap-3 border-l border-border py-4 pl-4 duration-normal">
      <div className="flex gap-1">
        <div className="h-1.5 w-1.5 animate-pulse bg-primary" style={{ animationDelay: '0s' }} />
        <div className="h-1.5 w-1.5 animate-pulse bg-primary" style={{ animationDelay: '0.25s' }} />
        <div className="h-1.5 w-1.5 animate-pulse bg-primary" style={{ animationDelay: '0.5s' }} />
      </div>
      <span className="type-kicker text-muted-foreground">{t('agentThinking')}</span>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation('common')

  return (
    <div className="flex min-h-full w-full items-center justify-center px-6 py-8 text-center">
      <div className="flex w-full max-w-3xl flex-col items-center border border-border px-8 py-10 sm:px-12 sm:py-14">
        <div className="w-full max-w-xl border-b border-border pb-8">
          <div className="flex items-center justify-center gap-4">
            <img src="/aimoda-logo.svg" alt="aimoda" className="h-8 w-auto dark:hidden" />
            <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden h-8 w-auto dark:block" />
            <div className="h-6 w-px bg-border" />
            <span className="type-kicker-wide text-foreground/88">{t('agent')}</span>
          </div>
        </div>
        <p className="type-body-muted mt-8 max-w-[42ch] text-muted-foreground">
          {t('chatEmptyHint')}
        </p>
      </div>
    </div>
  )
}

export function ChatPage() {
  const { t } = useTranslation('common')
  const isDesktop = useIsDesktop()
  const drawerWidthStorageKey = 'fashion-report-chat-drawer-width'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlSessionId = searchParams.get('session')
  const {
    planLabel,
    aiSummary,
    aiQuotaLabel,
    isLimitExceeded,
    aiStatus,
    refetch: refetchMembership,
  } = useMembershipStatus()
  const membershipBlocked = aiStatus?.allowed === false
  const chatInputDisabled = membershipBlocked || isLimitExceeded
  const [isCreatingParallelSession, setIsCreatingParallelSession] = useState(false)
  const chatInfoMessage = membershipBlocked
    ? t('membership.chatLockedMessage')
    : isLimitExceeded
      ? t('membership.chatLimitMessage')
      : undefined

  const [drawerWidthPercent, setDrawerWidthPercent] = useState(() => {
    if (typeof window === 'undefined') return 45
    const stored = Number(window.localStorage.getItem(drawerWidthStorageKey))
    return Number.isFinite(stored) && stored >= 28 && stored <= 62 ? stored : 45
  })
  const { isDrawerFullscreen, setDrawerFullscreen } = useChatLayoutStore()

  const {
    activeSessionId,
    sessions,
    loaded,
    setActiveSessionId,
    loadSessions,
    newSession,
  } = useSessionStore()
  const activeSession = sessions.find(session => session.id === activeSessionId) ?? null

  const {
    messages,
    isLoading,
    sendMessage,
    drawerOpen,
    setDrawerOpen,
    drawerData,
    openDrawerFromSearchRequestId,
    loadMoreDrawerImages,
  } = useChat(activeSessionId)
  const isSessionRunning = activeSession?.execution_status === 'running'

  const scrollRef = useRef<HTMLDivElement>(null)
  const initDone = useRef(false)
  const mainRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!initDone.current) {
      initDone.current = true
      loadSessions()
    }
  }, [loadSessions])

  useEffect(() => {
    if (urlSessionId && urlSessionId !== activeSessionId) {
      setActiveSessionId(urlSessionId)
    }
  }, [activeSessionId, setActiveSessionId, urlSessionId])

  useEffect(() => {
    if (!loaded) return

    if (urlSessionId && !sessions.some(session => session.id === urlSessionId)) {
      if (activeSessionId && sessions.some(session => session.id === activeSessionId)) {
        navigate(`/chat?session=${activeSessionId}`, { replace: true })
      } else {
        navigate('/chat', { replace: true })
      }
      return
    }

    if (!urlSessionId && activeSessionId && sessions.some(session => session.id === activeSessionId)) {
      navigate(`/chat?session=${activeSessionId}`, { replace: true })
    }
  }, [activeSessionId, loaded, navigate, sessions, urlSessionId])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    window.localStorage.setItem(drawerWidthStorageKey, String(drawerWidthPercent))
  }, [drawerWidthPercent])

  useEffect(() => {
    if (!drawerOpen || !isDesktop) {
      setDrawerFullscreen(false)
    }
  }, [drawerOpen, isDesktop, setDrawerFullscreen])

  useEffect(() => {
    return () => {
      setDrawerFullscreen(false)
    }
  }, [setDrawerFullscreen])

  useEffect(() => {
    if (!isDrawerFullscreen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerFullscreen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDrawerFullscreen, setDrawerFullscreen])

  const handleSend = useCallback(async (input: ChatComposerInput) => {
    const nextTitle = deriveSessionTitleFromBlocks(input.content)

    if (!activeSessionId) {
      const session = await newSession(nextTitle ?? '新对话')
      if (!session) return
      await sendMessage(input, session.id)
      void refetchMembership()
      return
    }

    await sendMessage(input)
    void refetchMembership()
  }, [activeSessionId, newSession, refetchMembership, sendMessage])

  const handleCreateParallelSession = useCallback(async () => {
    if (isCreatingParallelSession) return
    setIsCreatingParallelSession(true)
    try {
      const session = await newSession(t('fashionSearch'))
      if (!session) return
      navigate(`/chat?session=${session.id}`, { replace: false })
    } finally {
      setIsCreatingParallelSession(false)
    }
  }, [isCreatingParallelSession, navigate, newSession, t])

  const toggleDrawerFullscreen = useCallback(() => {
    if (!isDesktop || !drawerOpen) return
    setDrawerFullscreen(!isDrawerFullscreen)
  }, [drawerOpen, isDesktop, isDrawerFullscreen, setDrawerFullscreen])

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = mainRef.current
    if (!container) return

    event.preventDefault()
    const pointerId = event.pointerId
    event.currentTarget.setPointerCapture(pointerId)

    const updateWidth = (clientX: number) => {
      const rect = container.getBoundingClientRect()
      const nextChatWidth = ((clientX - rect.left) / rect.width) * 100
      const nextDrawerWidth = 100 - nextChatWidth
      const clamped = Math.max(28, Math.min(62, nextDrawerWidth))
      setDrawerWidthPercent(clamped)
    }

    updateWidth(event.clientX)

    const onPointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX)
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [])

  const chatWidthPercent = drawerOpen
    ? (isDesktop && isDrawerFullscreen ? 0 : 100 - drawerWidthPercent)
    : 100

  const composerStatusBar = (
    isSessionRunning || membershipBlocked || isLimitExceeded ? (
      <div className="flex flex-col gap-3">
        {isSessionRunning && (
          <div className="grid gap-3 border border-border/70 bg-background/78 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 space-y-1">
              <p className="type-ui-label-xs text-muted-foreground/72">
                {t('parallelSearchEyebrow')}
              </p>
              <p className="type-ui-meta text-muted-foreground/88">
                {t('parallelSearchHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCreateParallelSession()}
              disabled={isCreatingParallelSession}
              className="type-action-label control-pill-sm inline-flex items-center justify-center border border-border text-foreground transition-colors hover:border-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isCreatingParallelSession ? t('loading') : t('parallelSearchAction')}
            </button>
          </div>
        )}

        {(membershipBlocked || isLimitExceeded) && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 space-y-1">
              <p className="type-ui-label-xs text-muted-foreground/72">
                {t('membership.chatAccessEyebrow')} · {planLabel}
              </p>
              <p className={cn('type-ui-meta truncate text-muted-foreground/88', isLimitExceeded && 'text-destructive')}>
                {aiSummary}
              </p>
            </div>
            <div className="flex items-center gap-3 sm:justify-end">
              <span className={cn('type-ui-label-sm control-pill-sm inline-flex items-center text-muted-foreground/88', isLimitExceeded && 'text-destructive')}>
                {aiQuotaLabel}
              </span>
              <Link
                to="/profile?tab=access"
                className="type-action-label control-pill-sm inline-flex items-center border border-transparent text-foreground transition-colors hover:border-border hover:text-muted-foreground"
              >
                {t('membership.manageAction')}
              </Link>
            </div>
          </div>
        )}
      </div>
    ) : undefined
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div ref={mainRef} className="flex min-h-0 flex-1">
        <div
          className={cn(
            'flex min-h-0 w-full flex-1 flex-col border-r border-transparent transition-all duration-normal',
            (drawerOpen && !isDesktop) || (drawerOpen && isDesktop && isDrawerFullscreen)
              ? 'hidden'
              : 'flex',
          )}
          style={isDesktop ? { width: `${chatWidthPercent}%` } : undefined}
        >
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mx-auto w-full max-w-3xl border-t border-border pt-5 sm:pt-6">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} onOpenDrawer={openDrawerFromSearchRequestId} />
                ))}
                {isLoading && <LoadingIndicator />}
                <div ref={scrollRef} />
              </div>
            )}
          </div>

          <ChatInput
            onSend={handleSend}
            disabled={isLoading || isSessionRunning || chatInputDisabled}
            infoMessage={chatInfoMessage}
            statusBar={composerStatusBar}
          />
        </div>

        {drawerOpen && (
          <>
            {isDesktop && !isDrawerFullscreen && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('resizeDrawer')}
                onPointerDown={handleResizeStart}
                className="group relative w-3 shrink-0 touch-none cursor-col-resize bg-background"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground" />
                <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 bg-foreground/0 transition-colors group-hover:bg-foreground/10" />
              </div>
            )}
            <div
              className={cn(
                'flex min-w-0 shrink-0 flex-col border-l border-border bg-background',
                !isDesktop && 'fixed inset-0 z-50 bg-background',
                isDesktop && isDrawerFullscreen && 'w-full',
              )}
              style={isDesktop ? { width: isDrawerFullscreen ? '100%' : `${drawerWidthPercent}%` } : undefined}
            >
              {!isDesktop && (
                <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="type-ui-label-sm flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span>←</span>
                    <span>{t('backToChat')}</span>
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="flex h-8 w-8 items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <ImageDrawer
                open={drawerOpen}
                data={drawerData}
                isFullscreen={isDesktop && isDrawerFullscreen}
                onClose={() => setDrawerOpen(false)}
                onLoadMore={loadMoreDrawerImages}
                onToggleFullscreen={isDesktop ? toggleDrawerFullscreen : undefined}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
