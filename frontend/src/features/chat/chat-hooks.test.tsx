import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { resetChatMessageStore } from './chat-message-store'
import { useChat } from './chat-hooks'

vi.mock('./chat-api', () => ({
  DEFAULT_DRAWER_PAGE_SIZE: 50,
  sendChatSSE: vi.fn(),
  stopChatRun: vi.fn(),
  ChatStreamAbortedError: class ChatStreamAbortedError extends Error {},
  fetchCachedSearchSessionById: vi.fn(),
  listSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSessionApi: vi.fn(),
  getSessionMessages: vi.fn(),
}))

const sessionStoreMock = {
  sessions: [],
  markSessionExecutionStatus: vi.fn(),
  primeSessionForImmediateRun: vi.fn(),
  syncSessionRunId: vi.fn(),
  loadSessions: vi.fn().mockResolvedValue(undefined),
}

vi.mock('./session-store', () => ({
  useSessionStore: () => sessionStoreMock,
}))

import { ChatStreamAbortedError, DEFAULT_DRAWER_PAGE_SIZE, fetchCachedSearchSessionById, getSessionMessages, sendChatSSE, stopChatRun } from './chat-api'

const mockedGetSessionMessages = vi.mocked(getSessionMessages)
const mockedFetchCachedSearchSessionById = vi.mocked(fetchCachedSearchSessionById)
const mockedSendChatSSE = vi.mocked(sendChatSSE)
const mockedStopChatRun = vi.mocked(stopChatRun)

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useChat', () => {
  beforeEach(() => {
    resetChatMessageStore()
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation((message: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('not wrapped in act')) {
        return
      }
      if (args.length > 0) {
        console.warn(message, ...args)
        return
      }
      console.warn(message)
    })
  })

  afterEach(() => {
    resetChatMessageStore()
    vi.restoreAllMocks()
  })

  it('does not let a stale initial hydration wipe the first optimistic exchange', async () => {
    const historyRequest = createDeferred<Array<{ id: string; role: string; content: Array<{ type: 'text'; text: string }> }>>()
    mockedGetSessionMessages.mockReturnValueOnce(historyRequest.promise)
    mockedSendChatSSE.mockImplementation(async (_content, _sessionId, _history, onEvent) => {
      onEvent({ type: 'content_block_start', index: 0, block_type: 'text' })
      onEvent({ type: 'content_block_delta', index: 0, delta: '已为你找到结果。' })
      onEvent({ type: 'content_block_stop', index: 0 })
      onEvent({ type: 'message_stop', stop_reason: 'end_turn' })
    })

    let result!: ReturnType<typeof renderHook<ReturnType<typeof useChat>, unknown>>['result']
    await act(async () => {
      ({ result } = renderHook(() => useChat('session-1')))
    })

    expect(result.current.isHydratingHistory).toBe(true)

    await act(async () => {
      await result.current.sendMessage({
        content: [{ type: 'text', text: '帮我找红色连衣裙' }],
      })
    })

    act(() => {
      historyRequest.resolve([])
    })

    await act(async () => {
      await historyRequest.promise
    })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })
    expect(result.current.isHydratingHistory).toBe(false)
    expect(result.current.historyHydrationError).toBeNull()

    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: '帮我找红色连衣裙' }],
    })
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: '已为你找到结果。' }],
    })
  })

  it('ignores stale hydration results after the active session is cleared', async () => {
    const historyRequest = createDeferred<Array<{ id: string; role: string; content: Array<{ type: 'text'; text: string }> }>>()
    mockedGetSessionMessages.mockReturnValueOnce(historyRequest.promise)

    let result!: ReturnType<typeof renderHook<ReturnType<typeof useChat>, { sessionId: string | null }>>['result']
    let rerender!: (props: { sessionId: string | null }) => void
    await act(async () => {
      ({ result, rerender } = renderHook(
        ({ sessionId }: { sessionId: string | null }) => useChat(sessionId),
        { initialProps: { sessionId: 'session-1' as string | null } },
      ))
    })

    act(() => {
      rerender({ sessionId: null })
    })

    act(() => {
      historyRequest.resolve([
        {
          id: 'm-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'stale' }],
        },
      ])
    })

    await act(async () => {
      await historyRequest.promise
    })

    await waitFor(() => {
      expect(result.current.messages).toEqual([])
    })
  })

  it('surfaces hydration failure and allows retrying the current session', async () => {
    mockedGetSessionMessages
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce([
        {
          id: 'm-2',
          role: 'assistant',
          content: [{ type: 'text', text: 'retry success' }],
        },
      ])

    let result!: ReturnType<typeof renderHook<ReturnType<typeof useChat>, unknown>>['result']
    await act(async () => {
      ({ result } = renderHook(() => useChat('session-2')))
    })

    await waitFor(() => {
      expect(result.current.historyHydrationError).toContain('network timeout')
    })

    expect(result.current.isHydratingHistory).toBe(false)
    expect(result.current.messages).toEqual([])

    await act(async () => {
      await result.current.retryHydrateSession()
    })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1)
    })

    expect(result.current.historyHydrationError).toBeNull()
  })

  it('removes the empty optimistic assistant message when a run is explicitly stopped', async () => {
    const deferred = createDeferred<void>()
    const historyRequest = createDeferred<Array<{ id: string; role: string; content: Array<{ type: 'text'; text: string }> }>>()
    mockedGetSessionMessages.mockReturnValueOnce(historyRequest.promise)
    mockedStopChatRun.mockResolvedValueOnce(true)
    mockedSendChatSSE.mockImplementation(async (_content, _sessionId, _history, _onEvent, onOpen) => {
      onOpen?.({ runId: 'run-1' })
      await deferred.promise
    })

    let result!: ReturnType<typeof renderHook<ReturnType<typeof useChat>, unknown>>['result']
    await act(async () => {
      ({ result } = renderHook(() => useChat('session-1')))
    })

    act(() => {
      historyRequest.resolve([])
    })

    await act(async () => {
      await historyRequest.promise
    })

    let sendPromise!: Promise<void>
    await act(async () => {
      sendPromise = result.current.sendMessage({
        content: [{ type: 'text', text: '帮我找最新秀场外套' }],
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    await act(async () => {
      const stopPromise = result.current.stopMessage()
      deferred.reject(new ChatStreamAbortedError())
      await stopPromise
    })

    expect(sessionStoreMock.markSessionExecutionStatus).toHaveBeenCalledWith(
      'session-1',
      'stopping',
      null,
      'run-1',
    )

    await act(async () => {
      await sendPromise
    })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1)
    })

    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: '帮我找最新秀场外套' }],
    })
  })

  it('uses the current session retrieval preferences when opening a drawer artifact', async () => {
    const historyRequest = createDeferred<Array<{ id: string; role: string; content: Array<{ type: 'text'; text: string }> }>>()
    mockedGetSessionMessages.mockReturnValueOnce(historyRequest.promise)
    mockedFetchCachedSearchSessionById.mockResolvedValueOnce({
      images: [],
      total: 0,
      offset: 0,
      limit: DEFAULT_DRAWER_PAGE_SIZE,
      has_more: false,
    })

    let result!: ReturnType<typeof renderHook<ReturnType<typeof useChat>, unknown>>['result']
    await act(async () => {
      ({ result } = renderHook(() => useChat('session-1', {
        taste_profile_id: 'dna-1',
        taste_profile_weight: 0.4,
      })))
    })

    act(() => {
      historyRequest.resolve([])
    })

    await act(async () => {
      await historyRequest.promise
    })

    await act(async () => {
      await result.current.openDrawerFromSearchRequestId('artifact-1')
    })

    expect(mockedFetchCachedSearchSessionById).toHaveBeenCalledWith('artifact-1', 0, DEFAULT_DRAWER_PAGE_SIZE, 'dna-1', 0.4)
    expect(result.current.drawerData).toMatchObject({
      searchRequestId: 'artifact-1',
      tasteProfileId: 'dna-1',
      tasteProfileWeight: 0.4,
    })
  })
})
