import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'

import './i18n'
import '@/index.css'
import { router } from '@/app/router'
import { ApiError } from '@/lib/api'
import { initializeTheme } from '@/lib/theme-store'
import { AuthProvider } from '@/features/auth/auth-store'

const ENABLE_DEV_AUTO_LOGIN = import.meta.env.VITE_ENABLE_DEV_AUTO_LOGIN === 'true'
const AUTO_LOGIN_EMAIL = 'admin@fashion-report.local'
const AUTO_LOGIN_PASSWORD = 'ChangeMe123!'
const TOKEN_KEY = 'fashion-report-access-token'

async function ensureLoggedIn() {
  if (!ENABLE_DEV_AUTO_LOGIN || localStorage.getItem(TOKEN_KEY)) return
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: AUTO_LOGIN_EMAIL, password: AUTO_LOGIN_PASSWORD }),
    })
    if (!res.ok) return
    const data = await res.json()
    if (data?.data?.tokens?.accessToken) {
      localStorage.setItem(TOKEN_KEY, data.data.tokens.accessToken)
      console.log('[Dev] Auto-logged in as', AUTO_LOGIN_EMAIL)
    }
  } catch { /* ignore */ }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // 401/403 错误不重试，避免缓存认证失败
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return false
        }
        return failureCount < 3
      },
    },
  },
})

ensureLoggedIn().then(() => {
  initializeTheme()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  )
})
