import { Suspense, lazy, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'

import { AppShell } from '@/components/layout/app-shell'
import { ProtectedRoute } from '@/features/auth/protected-route'
import { RouteSeo } from '@/shared/seo/route-seo'
import { ROUTER_FUTURE } from '@/app/router-future'

const CoverPage = lazy(() => import('@/features/cover/cover-page').then((module) => ({ default: module.CoverPage })))
const ChatPage = lazy(() => import('@/features/chat/chat-page').then((module) => ({ default: module.ChatPage })))
const ReportsPage = lazy(() => import('@/features/reports/reports-page').then((module) => ({ default: module.ReportsPage })))
const ReportDetailPage = lazy(() => import('@/features/reports/report-detail-page').then((module) => ({ default: module.ReportDetailPage })))
const TrendFlowPage = lazy(() => import('@/features/trend-flow/trend-flow-page').then((module) => ({ default: module.TrendFlowPage })))
const ProfilePage = lazy(() => import('@/features/profile/profile-page').then((module) => ({ default: module.ProfilePage })))
const FavoriteCollectionsPage = lazy(() => import('@/features/favorites/favorite-collections-page').then((module) => ({ default: module.FavoriteCollectionsPage })))
const ImageDetailPage = lazy(() => import('@/features/chat/image-detail-page').then((module) => ({ default: module.ImageDetailPage })))
const InspirationPage = lazy(() => import('@/features/inspiration/inspiration-page').then((module) => ({ default: module.InspirationPage })))
const GalleryDetailPage = lazy(() => import('@/features/inspiration/gallery-detail-page').then((module) => ({ default: module.GalleryDetailPage })))

function RouteFallback() {
  return (
    <div className="px-5 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-4 border border-border bg-background p-5 shadow-token-sm sm:p-6">
        <div className="h-4 w-24 rounded-none bg-muted/70" />
        <div className="h-10 w-56 rounded-none bg-muted/60" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-32 rounded-none bg-muted/50" />
          <div className="h-32 rounded-none bg-muted/50" />
        </div>
      </div>
    </div>
  )
}

function withRouteSuspense(node: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>
}

function SeoLayout() {
  return (
    <>
      <RouteSeo />
      <Outlet />
    </>
  )
}

export const router = createBrowserRouter(
  [
    {
      element: <SeoLayout />,
      children: [
        {
          // Standalone full-screen pages (no sidebar)
          element: <ProtectedRoute />,
          children: [
            {
              path: '/image/:imageId',
              element: withRouteSuspense(<ImageDetailPage />),
            },
          ],
        },
        {
          element: <AppShell />,
          children: [
            {
              path: '/',
              element: withRouteSuspense(<CoverPage />),
            },
            {
              element: <ProtectedRoute />,
              children: [
                {
                  path: '/chat',
                  element: withRouteSuspense(<ChatPage />),
                },
                {
                  path: '/reports',
                  element: withRouteSuspense(<ReportsPage />),
                },
                {
                  path: '/report',
                  element: <Navigate to="/reports" replace />,
                },
                {
                  path: '/reports/:reportId',
                  element: withRouteSuspense(<ReportDetailPage />),
                },
                {
                  path: '/profile',
                  element: withRouteSuspense(<ProfilePage />),
                },
                {
                  path: '/collections',
                  element: withRouteSuspense(<FavoriteCollectionsPage />),
                },
                {
                  path: '/membership',
                  element: <Navigate to="/profile?tab=access" replace />,
                },
                {
                  path: '/trend-flow',
                  element: withRouteSuspense(<TrendFlowPage />),
                },
                {
                  path: '/inspiration',
                  element: withRouteSuspense(<InspirationPage />),
                },
                {
                  path: '/inspiration/:galleryId',
                  element: withRouteSuspense(<GalleryDetailPage />),
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  { future: ROUTER_FUTURE },
)
