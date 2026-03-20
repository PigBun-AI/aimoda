import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'

import type { AuthUser } from '@/lib/types'
import { clearAccessToken } from '@/lib/api'
import { useLoginDialog } from '@/features/auth/auth-store'

const sessionKey = 'fashion-report-session'

export function getStoredSession() {
  return window.localStorage.getItem(sessionKey)
}

export function saveSession(value: string) {
  window.localStorage.setItem(sessionKey, value)
}

export function clearSession() {
  window.localStorage.removeItem(sessionKey)
  clearAccessToken()
}

export function getSessionUser(): AuthUser | null {
  const session = getStoredSession()

  if (!session) {
    return null
  }

  try {
    return JSON.parse(session) as AuthUser
  } catch {
    clearSession()
    return null
  }
}

export function ProtectedRoute() {
  const sessionUser = getSessionUser()
  const { openLogin } = useLoginDialog()

  useEffect(() => {
    if (!sessionUser) {
      openLogin()
    }
  }, [sessionUser, openLogin])

  if (!sessionUser) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export function AdminRoute() {
  const sessionUser = getSessionUser()
  const { openLogin } = useLoginDialog()

  useEffect(() => {
    if (!sessionUser) {
      openLogin()
    }
  }, [sessionUser, openLogin])

  if (!sessionUser) {
    return <Navigate to="/" replace />
  }

  const isAdmin = sessionUser.role === 'admin' && sessionUser.permissions.includes('users:manage')

  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
