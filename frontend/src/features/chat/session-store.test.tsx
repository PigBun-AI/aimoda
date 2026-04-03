import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import i18n from '@/i18n'
import {
  loadSessions,
  markSessionExecutionStatus,
  primeSessionForImmediateRun,
  resetSessionStore,
  useSessionStore,
} from './session-store'

vi.mock('./chat-api', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSessionApi: vi.fn(),
  updateSession: vi.fn(),
}))

import { listSessions } from './chat-api'

const mockedListSessions = vi.mocked(listSessions)

describe('session store', () => {
  beforeEach(() => {
    void i18n.changeLanguage('zh-CN')
    act(() => {
      resetSessionStore()
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      resetSessionStore()
    })
  })

  it('keeps pinned sessions at the top and sorts them by pinned time', async () => {
    const { result } = renderHook(() => useSessionStore())

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'recent',
        user_id: 1,
        title: 'Recent',
        is_pinned: false,
        execution_status: 'idle',
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-21T10:00:00.000Z',
      },
      {
        id: 'older-pin',
        user_id: 1,
        title: 'Older Pin',
        is_pinned: true,
        pinned_at: '2026-03-21T08:00:00.000Z',
        execution_status: 'idle',
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-21T09:00:00.000Z',
      },
      {
        id: 'newer-pin',
        user_id: 1,
        title: 'Newer Pin',
        is_pinned: true,
        pinned_at: '2026-03-21T09:30:00.000Z',
        execution_status: 'idle',
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-21T09:30:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual([
      'newer-pin',
      'older-pin',
      'recent',
    ])
  })

  it('creates a completion notification when a running session finishes', async () => {
    const { result } = renderHook(() => useSessionStore())

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'running',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'completed',
        last_run_completed_at: '2026-03-21T09:35:00.000Z',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:35:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.notifications).toHaveLength(1)
    expect(result.current.notifications[0]).toMatchObject({
      sessionId: 'session-1',
      kind: 'completed',
      title: i18n.t('common:sessionCompletedTitle'),
    })
  })

  it('preserves optimistic running state when a stale session list still reports idle', async () => {
    const { result } = renderHook(() => useSessionStore())

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'idle',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    act(() => {
      markSessionExecutionStatus('session-1', 'running')
    })

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'idle',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:01.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions[0]?.execution_status).toBe('running')
  })

  it('only promotes a provisional title on the first turn', async () => {
    const { result } = renderHook(() => useSessionStore())

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: '新对话',
        title_source: 'default',
        title_locked: false,
        message_count: 0,
        execution_status: 'idle',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    act(() => {
      primeSessionForImmediateRun('session-1', { title: '蓝色连衣裙' })
    })

    expect(result.current.sessions[0]).toMatchObject({
      title: '蓝色连衣裙',
      title_source: 'heuristic',
      message_count: 1,
    })

    act(() => {
      primeSessionForImmediateRun('session-1', { title: '第二轮消息不该改标题' })
    })

    expect(result.current.sessions[0]).toMatchObject({
      title: '蓝色连衣裙',
      title_source: 'heuristic',
    })
  })

  it('does not override a manually locked title during optimistic updates', async () => {
    const { result } = renderHook(() => useSessionStore())

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: '我的精选',
        title_source: 'manual',
        title_locked: true,
        message_count: 0,
        execution_status: 'idle',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    act(() => {
      primeSessionForImmediateRun('session-1', { title: '不应该覆盖手动标题' })
    })

    expect(result.current.sessions[0]).toMatchObject({
      title: '我的精选',
      title_source: 'manual',
    })
  })
})
