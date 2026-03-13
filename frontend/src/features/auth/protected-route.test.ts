import { describe, expect, it } from 'vitest'

import { clearSession, getStoredSession, saveSession } from '@/features/auth/protected-route'

describe('session storage helpers', () => {
  it('persists session to localStorage', () => {
    clearSession()
    saveSession('session-token')

    expect(getStoredSession()).toBe('session-token')
  })

  it('clears persisted session', () => {
    saveSession('session-token')
    clearSession()

    expect(getStoredSession()).toBeNull()
  })
})
