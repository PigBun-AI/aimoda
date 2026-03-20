import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AuthProvider } from '@/features/auth/auth-store'
import { AdminRoute, ProtectedRoute, clearSession, saveSession } from '@/features/auth/protected-route'

describe('route guards', () => {
  afterEach(() => {
    clearSession()
  })

  it('redirects unauthenticated users to login', () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/reports']}>
          <Routes>
            <Route path="/" element={<div>cover page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/reports" element={<div>reports</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )

    expect(screen.getByText('cover page')).toBeInTheDocument()
  })

  it('blocks non-admin users from admin routes', () => {
    saveSession(
      JSON.stringify({
        id: 'user-1',
        name: 'Editor',
        email: 'editor@example.com',
        role: 'editor',
        permissions: ['reports:read'],
      }),
    )

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<div>admin page</div>} />
            </Route>
            <Route path="/" element={<div>cover page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )

    expect(screen.getByText('cover page')).toBeInTheDocument()
  })
})
