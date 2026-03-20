import { createBrowserRouter } from 'react-router-dom'

import { AppShell } from '@/components/layout/app-shell'
import { ProtectedRoute } from '@/features/auth/protected-route'
import { ReportDetailPage } from '@/features/reports/report-detail-page'
import { ReportsPage } from '@/features/reports/reports-page'
import { CoverPage } from '@/features/cover/cover-page'
import { ChatPage } from '@/features/chat/chat-page'
import { ProfilePage } from '@/features/profile/profile-page'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      {
        path: '/',
        element: <CoverPage />,
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: '/chat',
            element: <ChatPage />,
          },
          {
            path: '/reports',
            element: <ReportsPage />,
          },
          {
            path: '/report',
            element: <ReportsPage />,
          },
          {
            path: '/reports/:reportId',
            element: <ReportDetailPage />,
          },
          {
            path: '/profile',
            element: <ProfilePage />,
          },
        ],
      },
    ],
  },
])
