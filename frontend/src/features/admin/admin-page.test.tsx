import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ROUTER_FUTURE } from '@/app/router-future'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { AdminPage } from '@/features/admin/admin-page'

const adminUsers = [
  {
    id: 'admin-1',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin' as const,
    permissions: ['users:manage'],
    lastActiveAt: '2026-03-12T16:20:00.000Z',
  },
]

vi.mock('@/features/admin/use-admin-users', () => ({
  useAdminUsers: () => ({
    isLoading: false,
    data: adminUsers,
  }),
}))

describe('AdminPage', () => {
  it('renders admin user information', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <AdminPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Admin User')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
  })
})
