import { useEffect, useRef, useCallback, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChatInput } from './chat-input'
import { MessageBubble } from './message-bubble'
import { ImageDrawer } from './image-drawer'
import { useChat } from './chat-hooks'
import { useChatLayoutStore } from './chat-layout-store'
import { useSessionStore } from './session-store'
import { useIsDesktop } from '@/lib/use-breakpoint'
import { cn } from '@/lib/utils'
import type { ChatComposerInput } from './chat-types'

function LoadingIndicator() {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-2 py-4 pl-1 animate-in fade-in duration-normal">
      <div className="flex gap-1">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0s' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.25s' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.5s' }} />
      </div>
      <span className="text-xs text-muted-foreground">{t('agentThinking')}</span>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation('common')
  return (
    <div className="flex min-h-full w-full items-center justify-center px-6 py-8 text-center">
      <div className="flex w-full max-w-xl flex-col items-center">
        <div className="rounded-[28px] border border-border/80 bg-background/90 px-8 py-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-center gap-3">
            <img src="/aimoda-logo.svg" alt="aimoda" className="dark:hidden h-8 w-auto" />
            <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden dark:block h-8 w-auto" />
            <div className="h-6 w-px bg-border" />
            <span className="text-xl font-semibold tracking-[0.18em] text-foreground/88">{t('agent')}</span>
          </div>
        </div>
        <p className="mt-6 max-w-lg text-sm leading-7 text-muted-foreground">
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const initDone = useRef(false)
  const mainRef = useRef<HTMLDivElement>(null)


  // Load sessions on mount (once only)
  useEffect(() => {
    if (!initDone.current) {
      initDone.current = true
      loadSessions()
    }
  }, [])

  // Sync URL session param to active session
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


  // No more auto-create: session is created lazily on first message send

  // Auto-scroll on new messages
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
    // Lazy session creation: create on first message if no active session
    if (!activeSessionId) {
      const session = await newSession()
      if (!session) return
      // sendMessage will pick up the new activeSessionId on next render,
      // but we need to send immediately with the newly created session ID
      sendMessage(input, session.id)
      return
    }
    sendMessage(input)
  }, [activeSessionId, newSession, sendMessage])

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

  const chatWidthPercent =
    drawerOpen
      ? (isDesktop && isDrawerFullscreen ? 0 : 100 - drawerWidthPercent)
      : 100

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      {/* Main */}
      <div ref={mainRef} className="flex flex-1 min-h-0">
        {/* Chat panel */}
        <div
          className={cn(
            "flex w-full flex-1 flex-col min-h-0 transition-all duration-normal",
            (drawerOpen && !isDesktop) || (drawerOpen && isDesktop && isDrawerFullscreen)
              ? "hidden"
              : "flex"
          )}
          style={isDesktop ? { width: `${chatWidthPercent}%` } : undefined}
        >
          <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 sm:py-4">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="max-w-3xl mx-auto">
                {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} onOpenDrawer={openDrawerFromSearchRequestId} />
                ))}
                {isLoading && <LoadingIndicator />}
                <div ref={scrollRef} />
              </div>
            )}
          </div>
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>

        {/* Drawer */}
        {drawerOpen && (
          <>
            {/* Resize handle - desktop only */}
            {isDesktop && !isDrawerFullscreen && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('resizeDrawer')}
                onPointerDown={handleResizeStart}
                className="group relative w-3 shrink-0 cursor-col-resize touch-none"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-primary transition-colors" />
                <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-primary/0 group-hover:bg-primary/12 transition-colors" />
              </div>
            )}
            <div
              className={cn(
                "shrink-0 min-w-0 flex flex-col",
                !isDesktop && "fixed inset-0 z-50 bg-background",
                isDesktop && isDrawerFullscreen && "w-full"
              )}
              style={isDesktop ? { width: isDrawerFullscreen ? '100%' : `${drawerWidthPercent}%` } : undefined}
            >
              {/* Mobile header: back button */}
              {!isDesktop && (
                <div className="flex items-center h-12 px-4 border-b border-border shrink-0">
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>←</span>
                    <span>{t('backToChat')}</span>
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted"
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
