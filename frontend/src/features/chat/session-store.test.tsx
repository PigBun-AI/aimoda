import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import i18n from '@/i18n'
import {
  createNewSession,
  loadSessions,
  markSessionExecutionStatus,
  primeSessionForImmediateRun,
  resetSessionStore,
  updateSessionChatPreferences,
  useSessionStore,
} from './session-store'

vi.mock('./chat-api', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSessionApi: vi.fn(),
  updateSession: vi.fn(),
}))

import { createSession, listSessions, updateSession } from './chat-api'

const mockedListSessions = vi.mocked(listSessions)
const mockedCreateSession = vi.mocked(createSession)
const mockedUpdateSession = vi.mocked(updateSession)

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

  it('preserves optimistic session preferences while polling still returns stale preferences', async () => {
    const { result } = renderHook(() => useSessionStore())

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'running',
        preferences: {
          gender: 'female',
          season_groups: ['春夏'],
          years: [2026],
          taste_profile_id: null,
          taste_profile_weight: 0.24,
        },
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    let resolveUpdate: ((value: {
      id: string
      user_id: number
      title: string
      execution_status: 'running'
      preferences: {
        gender: 'male'
        season_groups: ['秋冬']
        years: [2027]
        taste_profile_id: null
        taste_profile_weight: 0.24
      }
      created_at: string
      updated_at: string
    }) => void) | null = null

    mockedUpdateSession.mockImplementationOnce(() => new Promise(resolve => {
      resolveUpdate = resolve
    }))

    await act(async () => {
      void updateSessionChatPreferences('session-1', {
        gender: 'male',
        season_groups: ['秋冬'],
        years: [2027],
        taste_profile_id: null,
        taste_profile_weight: 0.24,
      })
    })

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'running',
        preferences: {
          gender: 'female',
          season_groups: ['春夏'],
          years: [2026],
          taste_profile_id: null,
          taste_profile_weight: 0.24,
        },
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:01.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions[0]?.preferences).toMatchObject({
      gender: 'male',
      season_groups: ['秋冬'],
      years: [2027],
    })

    await act(async () => {
      resolveUpdate?.({
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'running',
        preferences: {
          gender: 'male',
          season_groups: ['秋冬'],
          years: [2027],
          taste_profile_id: null,
          taste_profile_weight: 0.24,
        },
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:05.000Z',
      })
      await Promise.resolve()
    })

    expect(result.current.sessions[0]?.preferences).toMatchObject({
      gender: 'male',
      season_groups: ['秋冬'],
      years: [2027],
    })
  })

  it('does not preserve optimistic running state once the same run id is completed by the server', async () => {
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
      markSessionExecutionStatus('session-1', 'running', null, 'run-1')
    })

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'completed',
        current_run_id: null,
        last_run_id: 'run-1',
        last_run_completed_at: '2026-03-21T09:31:00.000Z',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:31:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions[0]).toMatchObject({
      execution_status: 'completed',
      current_run_id: null,
      last_run_id: 'run-1',
    })
  })

  it('preserves a locally completed run when polling briefly returns the same run as running', async () => {
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
      markSessionExecutionStatus('session-1', 'running', null, 'run-1')
      markSessionExecutionStatus('session-1', 'completed', null, 'run-1')
    })

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'running',
        current_run_id: 'run-1',
        last_run_id: 'run-1',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:02.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions[0]).toMatchObject({
      execution_status: 'completed',
      current_run_id: null,
      last_run_id: 'run-1',
    })
  })

  it('preserves a local stopping state while polling still reports the run as running', async () => {
    const { result } = renderHook(() => useSessionStore())

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'running',
        current_run_id: 'run-1',
        last_run_id: 'run-1',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:00.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    act(() => {
      markSessionExecutionStatus('session-1', 'stopping', null, 'run-1')
    })

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: 'Trend Watch',
        execution_status: 'running',
        current_run_id: 'run-2',
        last_run_id: 'run-0',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:02.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions[0]).toMatchObject({
      execution_status: 'stopping',
      current_run_id: 'run-1',
      last_run_id: 'run-1',
    })
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

  it('preserves an optimistic heuristic title when a stale poll still returns the default title', async () => {
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
        updated_at: '2026-03-21T09:30:01.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions[0]).toMatchObject({
      title: '蓝色连衣裙',
      title_source: 'heuristic',
      message_count: 1,
    })
  })

  it('accepts a fresher ai title after the first turn completes', async () => {
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
      markSessionExecutionStatus('session-1', 'running')
    })

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: '高级蓝色通勤连衣裙',
        title_source: 'ai',
        title_locked: false,
        message_count: 2,
        execution_status: 'completed',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:08.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions[0]).toMatchObject({
      title: '高级蓝色通勤连衣裙',
      title_source: 'ai',
      execution_status: 'completed',
    })
  })

  it('creates a new session with the supplied provisional title', async () => {
    mockedCreateSession.mockResolvedValueOnce({
      id: 'session-2',
      user_id: 1,
      title: '红色连衣裙',
      title_source: 'default',
      title_locked: false,
      message_count: 0,
      execution_status: 'idle',
      created_at: '2026-03-21T10:00:00.000Z',
      updated_at: '2026-03-21T10:00:00.000Z',
    })

    await act(async () => {
      await createNewSession('红色连衣裙')
    })

    expect(mockedCreateSession).toHaveBeenCalledWith('红色连衣裙', undefined)
  })

  it('replaces a heuristic title with the finalized ai title from polling', async () => {
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

    mockedListSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        user_id: 1,
        title: '巴黎秀场蓝色连衣裙趋势',
        title_source: 'ai',
        title_locked: false,
        message_count: 2,
        execution_status: 'completed',
        created_at: '2026-03-21T09:00:00.000Z',
        updated_at: '2026-03-21T09:30:05.000Z',
      },
    ])

    await act(async () => {
      await loadSessions()
    })

    expect(result.current.sessions[0]).toMatchObject({
      title: '巴黎秀场蓝色连衣裙趋势',
      title_source: 'ai',
      execution_status: 'completed',
    })
  })
})
