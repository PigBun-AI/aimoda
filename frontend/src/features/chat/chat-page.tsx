import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { SlidersHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChatInput } from './chat-input'
import { getChatArtifact, resolveSearchPlanRef } from './chat-api'
import { ImageDrawer } from './image-drawer'
import { MessageBubble } from './message-bubble'
import { ChatPreferencesBar } from './chat-preferences-bar'
import type { ChatComposerInput, ChatSessionPreferences } from './chat-types'
import type { MessageRefTarget } from './message-refs'
import { useChat } from './chat-hooks'
import { useChatLayoutStore } from './chat-layout-store'
import { deriveSessionTitleFromBlocks } from './session-title'
import { useSessionStore } from './session-store'
import { useMembershipStatus } from '@/features/membership/use-membership'
import { listFavoriteCollections, type FavoriteCollection } from '@/features/favorites/favorites-api'
import { cn } from '@/lib/utils'
import { useIsDesktop } from '@/lib/use-breakpoint'

const EMPTY_CHAT_PREFERENCES: ChatSessionPreferences = {
  gender: null,
  quarter: null,
  year: null,
  taste_profile_id: null,
  taste_profile_weight: 0.24,
}

function normalizeChatPreferences(preferences?: ChatSessionPreferences | null): ChatSessionPreferences {
  return {
    gender: preferences?.gender ?? null,
    quarter: preferences?.quarter ?? null,
    year: preferences?.year ?? null,
    taste_profile_id: preferences?.taste_profile_id ?? null,
    taste_profile_weight: preferences?.taste_profile_weight ?? 0.24,
  }
}

function hasActiveChatPreferences(preferences: ChatSessionPreferences) {
  return Boolean(
    preferences.gender
    || preferences.quarter
    || preferences.year
    || preferences.taste_profile_id,
  )
}

function areChatPreferencesEqual(left: ChatSessionPreferences, right: ChatSessionPreferences) {
  return (
    (left.gender ?? null) === (right.gender ?? null)
    && (left.quarter ?? null) === (right.quarter ?? null)
    && (left.year ?? null) === (right.year ?? null)
    && (left.taste_profile_id ?? null) === (right.taste_profile_id ?? null)
    && (left.taste_profile_weight ?? 0.24) === (right.taste_profile_weight ?? 0.24)
  )
}

function getQuarterPreferenceLabel(
  quarter: ChatSessionPreferences['quarter'],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  switch (quarter) {
    case '早春':
      return t('chatPreferenceQuarterResort')
    case '春夏':
      return t('chatPreferenceQuarterSS')
    case '早秋':
      return t('chatPreferenceQuarterPreFall')
    case '秋冬':
      return t('chatPreferenceQuarterFW')
    default:
      return ''
  }
}

function LoadingIndicator() {
  const { t } = useTranslation('common')

  return (
    <div className="animate-in fade-in flex items-center gap-3 border-t border-border/80 py-4 duration-normal">
      <div className="h-px flex-1 bg-border/70" />
      <div className="flex min-w-0 items-center justify-center gap-2.5">
        <div className="flex gap-1">
          <div className="h-1 w-1 animate-pulse bg-foreground" style={{ animationDelay: '0s' }} />
          <div className="h-1 w-1 animate-pulse bg-foreground" style={{ animationDelay: '0.25s' }} />
          <div className="h-1 w-1 animate-pulse bg-foreground" style={{ animationDelay: '0.5s' }} />
        </div>
        <span className="type-chat-kicker text-muted-foreground">{t('agentThinking')}</span>
      </div>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation('common')

  return (
    <div className="flex min-h-full w-full items-center justify-center px-6 py-8 text-center">
      {/* Keep the empty state deliberately simple; the editorialized split layout
          pulled too much attention and made the chat entry feel heavier. */}
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
  const [preferenceCollections, setPreferenceCollections] = useState<FavoriteCollection[]>([])
  const [draftPreferences, setDraftPreferences] = useState<ChatSessionPreferences>(EMPTY_CHAT_PREFERENCES)
  const [preferenceEditor, setPreferenceEditor] = useState<ChatSessionPreferences>(EMPTY_CHAT_PREFERENCES)
  const [isPreferencesDialogOpen, setIsPreferencesDialogOpen] = useState(false)
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
    updateSessionChatPreferences,
  } = useSessionStore()
  const activeSession = sessions.find(session => session.id === activeSessionId) ?? null

  const {
    messages,
    isLoading,
    isStopping: isStoppingLocal,
    stopMessage,
    sendMessage,
    drawerOpen,
    setDrawerOpen,
    drawerData,
    openDrawerFromSearchRequestId,
    loadMoreDrawerImages,
    applyDrawerTasteProfile,
  } = useChat(
    activeSessionId,
    {
      taste_profile_id: draftPreferences.taste_profile_id ?? null,
      taste_profile_weight: draftPreferences.taste_profile_weight ?? 0.24,
    },
  )
  const isSessionRunning = activeSession?.execution_status === 'running'
  const isSessionStopping = activeSession?.execution_status === 'stopping'
  const isSessionActive = isSessionRunning || isSessionStopping
  const isStopping = isStoppingLocal || isSessionStopping

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
    listFavoriteCollections()
      .then(result => {
        setPreferenceCollections(result.filter(collection => collection.can_apply_as_dna ?? collection.can_apply_as_taste))
      })
      .catch(() => {
        setPreferenceCollections([])
      })
  }, [])

  useEffect(() => {
    if (!draftPreferences.taste_profile_id) return
    if (preferenceCollections.some(collection => collection.id === draftPreferences.taste_profile_id)) return

    const nextPreferences = { ...draftPreferences, taste_profile_id: null }
    setDraftPreferences(nextPreferences)
    if (activeSessionId) {
      void updateSessionChatPreferences(activeSessionId, nextPreferences)
    }
  }, [activeSessionId, draftPreferences, preferenceCollections, updateSessionChatPreferences])

  useEffect(() => {
    if (activeSession) {
      setDraftPreferences(normalizeChatPreferences(activeSession.preferences))
    }
  }, [activeSession?.id, activeSession?.preferences])

  useEffect(() => {
    if (!isPreferencesDialogOpen) return
    setPreferenceEditor(normalizeChatPreferences(draftPreferences))
  }, [draftPreferences, isPreferencesDialogOpen])

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
      const session = await newSession(nextTitle ?? '新对话', draftPreferences)
      if (!session) return
      await sendMessage(input, session.id)
      void refetchMembership()
      return
    }

    await sendMessage(input)
    void refetchMembership()
  }, [activeSessionId, draftPreferences, newSession, refetchMembership, sendMessage])

  const handleCreateParallelSession = useCallback(async () => {
    if (isCreatingParallelSession) return
    setIsCreatingParallelSession(true)
    try {
      const session = await newSession(t('fashionSearch'), draftPreferences)
      if (!session) return
      navigate(`/chat?session=${session.id}`, { replace: false })
    } finally {
      setIsCreatingParallelSession(false)
    }
  }, [draftPreferences, isCreatingParallelSession, navigate, newSession, t])

  const handlePreferencesChange = useCallback((next: ChatSessionPreferences) => {
    setPreferenceEditor(normalizeChatPreferences(next))
  }, [])

  const commitPreferences = useCallback((next: ChatSessionPreferences) => {
    const normalized = normalizeChatPreferences(next)
    setDraftPreferences(normalized)
    if (!activeSessionId) return
    void updateSessionChatPreferences(activeSessionId, normalized)
  }, [activeSessionId, updateSessionChatPreferences])

  const handleOpenPreferencesDialog = useCallback(() => {
    setPreferenceEditor(normalizeChatPreferences(draftPreferences))
    setIsPreferencesDialogOpen(true)
  }, [draftPreferences])

  const handleApplyPreferences = useCallback(() => {
    commitPreferences(preferenceEditor)
    setIsPreferencesDialogOpen(false)
  }, [commitPreferences, preferenceEditor])

  const handleResetPreferences = useCallback(() => {
    setPreferenceEditor({ ...EMPTY_CHAT_PREFERENCES })
  }, [])

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

  const hasComposerStatusBar = isSessionRunning || membershipBlocked || isLimitExceeded
  const composerStatusBar = hasComposerStatusBar ? (
    <div className="flex flex-col gap-2.5">
      {isSessionRunning && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0 space-y-1">
            <p className="type-chat-kicker text-muted-foreground/72">
              {t('parallelSearchEyebrow')}
            </p>
            <p className="type-chat-meta text-muted-foreground/88">
              {t('parallelSearchHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCreateParallelSession()}
            disabled={isCreatingParallelSession}
            className="type-chat-action control-pill-sm inline-flex items-center justify-center border border-border text-foreground transition-colors hover:border-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isCreatingParallelSession ? t('loading') : t('parallelSearchAction')}
          </button>
        </div>
      )}

      {(membershipBlocked || isLimitExceeded) && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0 space-y-1">
            <p className="type-chat-kicker text-muted-foreground/72">
              {t('membership.chatAccessEyebrow')} · {planLabel}
            </p>
            <p className={cn('type-chat-meta truncate text-muted-foreground/88', isLimitExceeded && 'text-destructive')}>
              {aiSummary}
            </p>
          </div>
          <div className="flex items-center gap-3 sm:justify-end">
            <span className={cn('type-chat-label control-pill-sm inline-flex items-center border border-border/70 px-3 text-muted-foreground/88', isLimitExceeded && 'border-destructive/30 text-destructive')}>
              {aiQuotaLabel}
            </span>
            <Link
              to="/profile?tab=access"
              className="type-chat-action control-pill-sm inline-flex items-center border border-transparent text-foreground transition-colors hover:border-border hover:text-muted-foreground"
            >
              {t('membership.manageAction')}
            </Link>
          </div>
        </div>
      )}
    </div>
  ) : null

  const preferenceSummary = useMemo(() => {
    const parts: string[] = []
    if (draftPreferences.gender) {
      parts.push(t(draftPreferences.gender === 'female' ? 'chatPreferenceFemale' : 'chatPreferenceMale'))
    }
    if (draftPreferences.quarter) {
      parts.push(getQuarterPreferenceLabel(draftPreferences.quarter, t))
    }
    if (draftPreferences.year) {
      parts.push(String(draftPreferences.year))
    }
    if (draftPreferences.taste_profile_id) {
      const matchedCollection = preferenceCollections.find(collection => collection.id === draftPreferences.taste_profile_id)
      if (matchedCollection?.name) {
        parts.push(matchedCollection.name)
      }
    }
    return parts.length > 0 ? parts.join(' · ') : t('chatPreferenceAll')
  }, [draftPreferences, preferenceCollections, t])

  const hasPendingPreferenceChanges = !areChatPreferencesEqual(draftPreferences, preferenceEditor)

  const handleMessageRefClick = useCallback((target: MessageRefTarget) => {
    if (target.kind === 'search_request') {
      void openDrawerFromSearchRequestId(target.search_request_id)
      return
    }

    if (target.kind === 'bundle_group') {
      void getChatArtifact(target.artifact_id)
        .then((artifact) => {
          const groups = Array.isArray(artifact.metadata?.groups)
            ? artifact.metadata.groups as Array<Record<string, unknown>>
            : []
          const matched = groups.find(group => String(group.group_id ?? '') === target.group_id)
          const searchRequestId = typeof matched?.search_request_id === 'string' ? matched.search_request_id : null
          if (searchRequestId) {
            return openDrawerFromSearchRequestId(searchRequestId)
          }
          return undefined
        })
        .catch((error) => {
          console.error('Failed to resolve bundle group ref', error)
        })
      return
    }

    if (target.kind === 'search_plan') {
      void resolveSearchPlanRef(target, activeSessionId)
        .then((payload) => {
          if (payload.search_request_id) {
            return openDrawerFromSearchRequestId(payload.search_request_id)
          }
          return undefined
        })
        .catch((error) => {
          console.error('Failed to resolve search plan ref', error)
        })
    }
  }, [activeSessionId, openDrawerFromSearchRequestId])

  const preferenceActionBar = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleOpenPreferencesDialog}
      className={cn(
        'h-11 min-w-[112px] items-center justify-start gap-2 rounded-none px-3 text-left',
        hasActiveChatPreferences(draftPreferences) && 'border-foreground/55',
      )}
    >
      <SlidersHorizontal size={14} />
      <span className="flex min-w-0 flex-col items-start leading-none">
        <span className="type-chat-action">{t('chatPreferencesTitle')}</span>
        <span className="type-chat-meta max-w-[16ch] truncate text-muted-foreground/72">
          {preferenceSummary}
        </span>
      </span>
    </Button>
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
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mx-auto w-full max-w-3xl border-t border-border/80 pt-6 sm:pt-8">
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    onOpenDrawer={openDrawerFromSearchRequestId}
                    onMessageRefClick={handleMessageRefClick}
                    retrievalPreferences={draftPreferences}
                  />
                ))}
                {isLoading && <LoadingIndicator />}
                <div ref={scrollRef} />
              </div>
            )}
          </div>

          <ChatInput
            onSend={handleSend}
            onStop={() => void stopMessage()}
            disabled={isLoading || isSessionActive || chatInputDisabled}
            isRunning={isSessionActive}
            isStopping={isStopping}
            infoMessage={chatInfoMessage}
            statusBar={composerStatusBar}
            actionBar={preferenceActionBar}
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
                    className="type-chat-label flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
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
                onTasteProfileChange={applyDrawerTasteProfile}
                onToggleFullscreen={isDesktop ? toggleDrawerFullscreen : undefined}
              />
            </div>
          </>
        )}
      </div>

      <Dialog open={isPreferencesDialogOpen} onOpenChange={setIsPreferencesDialogOpen}>
        <DialogContent className="max-w-[880px] rounded-none border-border/80">
          <DialogHeader>
            <DialogTitle>{t('chatPreferencesTitle')}</DialogTitle>
            <DialogDescription>{t('chatPreferencesHint')}</DialogDescription>
          </DialogHeader>

          <ChatPreferencesBar
            value={preferenceEditor}
            collections={preferenceCollections}
            onChange={handlePreferencesChange}
            showHeader={false}
            className="gap-0"
          />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleResetPreferences}>
              {t('chatPreferenceAll')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setIsPreferencesDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={handleApplyPreferences} disabled={!hasPendingPreferenceChanges}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
