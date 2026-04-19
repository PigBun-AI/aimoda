import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { ROUTER_FUTURE } from '@/app/router-future'
import { ChatPage } from './chat-page'

const mockUseChat = vi.fn()
const mockUseSessionStore = vi.fn()

vi.mock('./chat-hooks', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args),
}))

vi.mock('./session-store', () => ({
  useSessionStore: () => mockUseSessionStore(),
}))

vi.mock('@/features/membership/use-membership', () => ({
  useMembershipStatus: () => ({
    planLabel: 'Pro',
    aiSummary: 'ready',
    aiQuotaLabel: '10/10',
    isLimitExceeded: false,
    aiStatus: { allowed: true },
    refetch: vi.fn(),
  }),
}))

vi.mock('@/features/favorites/favorites-api', () => ({
  listFavoriteCollections: vi.fn().mockResolvedValue([]),
}))

vi.mock('./chat-api', async () => {
  const actual = await vi.importActual<typeof import('./chat-api')>('./chat-api')
  return {
    ...actual,
    getChatArtifact: vi.fn(),
    getChatPreferenceOptions: vi.fn().mockResolvedValue({
      sites: [],
      image_types: [],
      years: [],
      season_groups: [],
    }),
    resolveSearchPlanRef: vi.fn(),
  }
})

vi.mock('@/lib/use-breakpoint', () => ({
  useIsDesktop: () => true,
}))

vi.mock('./chat-input', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}))

vi.mock('./message-bubble', () => ({
  MessageBubble: ({ msg }: { msg: { content: Array<{ text?: string }> } }) => (
    <div>{msg.content[0]?.text ?? 'message'}</div>
  ),
}))

vi.mock('./image-drawer', () => ({
  ImageDrawer: () => null,
}))

describe('ChatPage', () => {
  it('renders session history skeleton instead of empty state while hydrating a populated session', () => {
    mockUseSessionStore.mockReturnValue({
      activeSessionId: 'session-1',
      sessions: [{
        id: 'session-1',
        user_id: 1,
        title: 'History',
        message_count: 4,
        preferences: {},
        created_at: '2026-04-20T00:00:00Z',
        updated_at: '2026-04-20T00:00:00Z',
      }],
      loaded: true,
      setActiveSessionId: vi.fn(),
      loadSessions: vi.fn(),
      newSession: vi.fn(),
      updateSessionChatPreferences: vi.fn(),
    })
    mockUseChat.mockReturnValue({
      messages: [],
      isLoading: false,
      isHydratingHistory: true,
      historyHydrationError: null,
      retryHydrateSession: vi.fn(),
      isStopping: false,
      stopMessage: vi.fn(),
      sendMessage: vi.fn(),
      drawerOpen: false,
      setDrawerOpen: vi.fn(),
      drawerData: null,
      openDrawerFromSearchRequestId: vi.fn(),
      loadMoreDrawerImages: vi.fn(),
      applyDrawerTasteProfile: vi.fn(),
    })

    render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <ChatPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Loading this session...')).toBeInTheDocument()
    expect(screen.queryByText('Describe the look in your mind and I\'ll help you find it on the runway.')).not.toBeInTheDocument()
  })

  it('renders a retry state when session hydration fails', () => {
    const retryHydrateSession = vi.fn()
    mockUseSessionStore.mockReturnValue({
      activeSessionId: 'session-2',
      sessions: [{
        id: 'session-2',
        user_id: 1,
        title: 'History',
        message_count: 2,
        preferences: {},
        created_at: '2026-04-20T00:00:00Z',
        updated_at: '2026-04-20T00:00:00Z',
      }],
      loaded: true,
      setActiveSessionId: vi.fn(),
      loadSessions: vi.fn(),
      newSession: vi.fn(),
      updateSessionChatPreferences: vi.fn(),
    })
    mockUseChat.mockReturnValue({
      messages: [],
      isLoading: false,
      isHydratingHistory: false,
      historyHydrationError: 'network timeout',
      retryHydrateSession,
      isStopping: false,
      stopMessage: vi.fn(),
      sendMessage: vi.fn(),
      drawerOpen: false,
      setDrawerOpen: vi.fn(),
      drawerData: null,
      openDrawerFromSearchRequestId: vi.fn(),
      loadMoreDrawerImages: vi.fn(),
      applyDrawerTasteProfile: vi.fn(),
    })

    render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <ChatPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Failed to load session')).toBeInTheDocument()
    expect(screen.getByText('network timeout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
