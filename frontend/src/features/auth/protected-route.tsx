import { Navigate, Outlet, useLocation } from 'react-router-dom'

import type { AuthUser } from '@/lib/types'
import { clearAccessToken } from '@/lib/api'

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
  const location = useLocation()
  const sessionUser = getSessionUser()

  if (!sessionUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}

export function AdminRoute() {
  const location = useLocation()
  const sessionUser = getSessionUser()

  if (!sessionUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const isAdmin = sessionUser.role === 'admin' && sessionUser.permissions.includes('users:manage')

  if (!isAdmin) {
    return <Navigate to="/reports" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
