import { createBrowserRouter, Navigate } from 'react-router-dom'

import { AppShell } from '@/components/layout/app-shell'
import { LoginPage } from '@/features/auth/login-page'
import { RegisterPage } from '@/features/auth/register-page'
import { AdminRoute, ProtectedRoute } from '@/features/auth/protected-route'
import { AdminPage } from '@/features/admin/admin-page'
import { ArticlesPage } from '@/features/admin/articles-page'
import { DashboardPage } from '@/features/admin/dashboard-page'
import { RedemptionCodesPage } from '@/features/admin/redemption-codes-page'
import { ReportDetailPage } from '@/features/reports/report-detail-page'
import { ReportsPage } from '@/features/reports/reports-page'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate replace to="/reports" />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/reports/:reportId',
        element: <ReportDetailPage />,
      },
      {
        element: <AppShell />,
        children: [
          {
            path: '/reports',
            element: <ReportsPage />,
          },
          {
            element: <AdminRoute />,
            children: [
              {
                path: '/admin',
                element: <DashboardPage />,
              },
              {
                path: '/admin/articles',
                element: <ArticlesPage />,
              },
              {
                path: '/admin/users',
                element: <AdminPage />,
              },
              {
                path: '/admin/redemption-codes',
                element: <RedemptionCodesPage />,
              },
            ],
          },
        ],
      },
    ],
  },
])
