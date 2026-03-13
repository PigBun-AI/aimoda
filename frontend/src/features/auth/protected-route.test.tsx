import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AdminRoute, ProtectedRoute, clearSession, saveSession } from '@/features/auth/protected-route'

describe('route guards', () => {
  afterEach(() => {
    clearSession()
  })

  it('redirects unauthenticated users to login', () => {
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/reports" element={<div>reports</div>} />
          </Route>
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('login page')).toBeInTheDocument()
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
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<div>admin page</div>} />
          </Route>
          <Route path="/reports" element={<div>reports page</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('reports page')).toBeInTheDocument()
  })
})
