import { createBrowserRouter } from 'react-router-dom'

import { AppShell } from '@/components/layout/app-shell'
import { ProtectedRoute } from '@/features/auth/protected-route'
import { ReportDetailPage } from '@/features/reports/report-detail-page'
import { ReportsPage } from '@/features/reports/reports-page'
import { CoverPage } from '@/features/cover/cover-page'
import { ChatPage } from '@/features/chat/chat-page'
import { ProfilePage } from '@/features/profile/profile-page'
import { ImageDetailPage } from '@/features/chat/image-detail-page'
import { InspirationPage } from '@/features/inspiration/inspiration-page'
import { GalleryDetailPage } from '@/features/inspiration/gallery-detail-page'

export const router = createBrowserRouter([
  {
    // Standalone full-screen pages (no sidebar)
    element: <ProtectedRoute />,
    children: [
      {
        path: '/image/:imageId',
        element: <ImageDetailPage />,
      },
    ],
  },
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
          {
            path: '/inspiration',
            element: <InspirationPage />,
          },
          {
            path: '/inspiration/:galleryId',
            element: <GalleryDetailPage />,
          },
        ],
      },
    ],
  },
])
