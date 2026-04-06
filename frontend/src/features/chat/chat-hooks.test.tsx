import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { resetChatMessageStore } from './chat-message-store'
import { useChat } from './chat-hooks'

vi.mock('./chat-api', () => ({
  sendChatSSE: vi.fn(),
  stopChatRun: vi.fn(),
  ChatStreamAbortedError: class ChatStreamAbortedError extends Error {},
  fetchSearchSessionById: vi.fn(),
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

import { ChatStreamAbortedError, getSessionMessages, sendChatSSE, stopChatRun } from './chat-api'

const mockedGetSessionMessages = vi.mocked(getSessionMessages)
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
  })

  afterEach(() => {
    resetChatMessageStore()
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

  it('removes the empty optimistic assistant message when a run is explicitly stopped', async () => {
    const deferred = createDeferred<void>()
    mockedGetSessionMessages.mockResolvedValueOnce([])
    mockedStopChatRun.mockResolvedValueOnce(true)
    mockedSendChatSSE.mockImplementation(async (_content, _sessionId, _history, _onEvent, onOpen) => {
      onOpen?.({ runId: 'run-1' })
      await deferred.promise
    })

    let result!: ReturnType<typeof renderHook<ReturnType<typeof useChat>, unknown>>['result']
    await act(async () => {
      ({ result } = renderHook(() => useChat('session-1')))
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
})
