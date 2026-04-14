import { Suspense, lazy, type ReactNode, useCallback, useEffect, useState } from 'react'
import { BarChart3, FileText, Image as ImageIcon, LogOut, Tags, Ticket, User, UserCog } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { queryClient } from '@/main'
import { PageFrame } from '@/components/layout/page-frame'
import { PageIntro } from '@/components/layout/page-intro'
import { Button } from '@/components/ui/button'
import { clearSession, getSessionUser } from '@/features/auth/protected-route'
import { MembershipOverview } from '@/features/membership/membership-overview'
import { useMembershipStatus } from '@/features/membership/use-membership'
import { cn } from '@/lib/utils'

const DashboardTabPage = lazy(() => import('@/features/admin/dashboard-page').then((module) => ({ default: module.DashboardPage })))
const ArticlesTabPage = lazy(() => import('@/features/admin/articles-page').then((module) => ({ default: module.ArticlesPage })))
const AdminUsersTabPage = lazy(() => import('@/features/admin/admin-page').then((module) => ({ default: module.AdminPage })))
const RedemptionCodesTabPage = lazy(() => import('@/features/admin/redemption-codes-page').then((module) => ({ default: module.RedemptionCodesPage })))
const AdminGalleriesTabPage = lazy(() => import('@/features/admin/admin-galleries-page').then((module) => ({ default: module.AdminGalleriesPage })))
const StyleGapTabPage = lazy(() => import('@/features/admin/style-gap-page').then((module) => ({ default: module.StyleGapPage })))

type TabId = 'profile' | 'access' | 'dashboard' | 'articles' | 'galleries' | 'styleGaps' | 'users' | 'redemption'

interface TabConfig {
  id: TabId
  labelKey: string
  icon: typeof User
  requiresAdmin?: boolean
}

export function ProfilePage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const currentUser = getSessionUser()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabs: TabConfig[] = [
    { id: 'profile', labelKey: 'profileTab', icon: User },
    { id: 'access', labelKey: 'accessTab', icon: Ticket },
    { id: 'dashboard', labelKey: 'dashboardTab', icon: BarChart3, requiresAdmin: true },
    { id: 'articles', labelKey: 'articlesTab', icon: FileText, requiresAdmin: true },
    { id: 'galleries', labelKey: 'galleriesTab', icon: ImageIcon, requiresAdmin: true },
    { id: 'styleGaps', labelKey: 'styleGapsTab', icon: Tags, requiresAdmin: true },
    { id: 'users', labelKey: 'usersTab', icon: UserCog, requiresAdmin: true },
    { id: 'redemption', labelKey: 'redemptionTab', icon: Ticket, requiresAdmin: true },
  ]

  const visibleTabs = tabs.filter(tab => !tab.requiresAdmin || currentUser?.role === 'admin')
  const resolveTab = (value: string | null): TabId => (
    visibleTabs.some(tab => tab.id === value) ? (value as TabId) : 'profile'
  )
  const [activeTab, setActiveTab] = useState<TabId>(() => resolveTab(searchParams.get('tab')))

  useEffect(() => {
    if (searchParams.get('tab') === 'favorites') {
      navigate('/collections', { replace: true })
      return
    }
    const nextTab = resolveTab(searchParams.get('tab'))
    setActiveTab(current => (current === nextTab ? current : nextTab))
  }, [navigate, searchParams, visibleTabs])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileContent />
      case 'access':
        return <AccessContent />
      case 'dashboard':
        return renderWorkbenchTab(<DashboardTabPage />)
      case 'articles':
        return renderWorkbenchTab(<ArticlesTabPage />)
      case 'galleries':
        return renderWorkbenchTab(<AdminGalleriesTabPage />)
      case 'styleGaps':
        return renderWorkbenchTab(<StyleGapTabPage />)
      case 'users':
        return renderWorkbenchTab(<AdminUsersTabPage />)
      case 'redemption':
        return renderWorkbenchTab(<RedemptionCodesTabPage />)
      default:
        return <ProfileContent />
    }
  }

  return (
    <PageFrame fullHeight>
      <PageIntro
        eyebrow={currentUser?.role ?? 'guest'}
        title={currentUser?.name ?? t('profileTab')}
        aside={(
          <div className="flex h-full flex-col justify-between gap-4">
            <p className="type-meta max-w-[32ch] break-all text-pretty text-muted-foreground">
              {currentUser?.email ?? currentUser?.phone ?? t('notSet')}
            </p>
            <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
              <span>{t('profile.accountLabel')}</span>
              <span className="tabular-nums">{String(visibleTabs.length).padStart(2, '0')}</span>
            </div>
          </div>
        )}
        className="shrink-0"
      />

      <div className="relative shrink-0 border-b border-border/60 px-0 pb-2">
        <div className="scrollbar-hide flex items-center gap-2.5 overflow-x-auto sm:gap-3">
          {visibleTabs.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  const nextParams = new URLSearchParams(searchParams)
                  if (tab.id === 'profile') {
                    nextParams.delete('tab')
                  } else {
                    nextParams.set('tab', tab.id)
                  }
                  setSearchParams(nextParams, { replace: true })
                }}
                className={cn(
                  'type-chat-kicker relative flex items-center gap-2 whitespace-nowrap rounded-none border px-3.5 py-2.5 transition-[background-color,border-color,color,transform] duration-fast cursor-pointer',
                  isActive ? 'border-border bg-card text-foreground shadow-token-sm' : 'border-transparent text-muted-foreground hover:-translate-y-px hover:border-border/60 hover:bg-card/72 hover:text-foreground',
                )}
              >
                <Icon size={14} />
                {t(tab.labelKey)}
              </button>
            )
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 border-l border-border/20 bg-background/84" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden animate-fade-in">
        {renderTabContent()}
      </div>
    </PageFrame>
  )
}

function WorkbenchScrollArea({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
      {children}
    </div>
  )
}

function WorkbenchLoading() {
  return (
    <div className="space-y-4">
      <div className="h-4 w-24 rounded-none bg-muted/70" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 rounded-none border border-border bg-muted/45" />
        ))}
      </div>
      <div className="h-44 rounded-none border border-border bg-muted/35" />
    </div>
  )
}

function renderWorkbenchTab(node: ReactNode) {
  return (
    <WorkbenchScrollArea>
      <Suspense fallback={<WorkbenchLoading />}>{node}</Suspense>
    </WorkbenchScrollArea>
  )
}

function ProfileContent() {
  const { t, i18n } = useTranslation('common')
  const navigate = useNavigate()
  const currentUser = getSessionUser()
  const { hasSubscription, planLabel, subscriptionStartsAt, subscriptionEndsAt } = useMembershipStatus()

  const handleLogout = useCallback(() => {
    queryClient.clear()
    clearSession()
    navigate('/', { replace: true })
  }, [navigate])

  const formatDateLabel = useCallback((value: string | null) => {
    if (!value) return t('notSet')
    return new Intl.DateTimeFormat(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value))
  }, [i18n.language, t])

  return (
    <div className="grid h-full min-h-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
      <section className="min-h-0 overflow-y-auto px-0 py-1 sm:px-0">
        <div className="grid gap-4 border border-border/70 bg-card shadow-token-md">
          <div className="grid gap-4 border-b border-border/60 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(160px,0.5fr)]">
            <div className="space-y-2">
              <p className="type-chat-kicker text-muted-foreground">
                {t('profile.accountEyebrow')}
              </p>
              <h2 className="type-ed-title-sm text-foreground">
                {t('profile.accountTitle')}
              </h2>
            </div>

            <div className="flex flex-col justify-end gap-2.5 border-t border-border/60 pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
              <p className="type-meta text-muted-foreground">
                {currentUser?.role ?? 'guest'}
              </p>
              <div className="type-chat-kicker flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
                <span>{t('profile.fieldsLabel')}</span>
                <span>03</span>
              </div>
            </div>
          </div>

          <div className="px-4">
            <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:gap-6">
              <span className="type-meta text-muted-foreground">{t('username')}</span>
              <span className="type-label text-foreground sm:text-right">{currentUser?.name ?? t('notSet')}</span>
            </div>
            <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:gap-6">
              <span className="type-meta text-muted-foreground">{t('role')}</span>
              <span className="type-chat-kicker text-foreground sm:text-right">{currentUser?.role ?? 'guest'}</span>
            </div>
            <div className="flex flex-col items-start justify-between gap-1.5 py-4 sm:flex-row sm:items-center sm:gap-6">
              <span className="type-meta text-muted-foreground">{t('email')}</span>
              <span className="type-label break-all text-foreground sm:text-right">{currentUser?.email ?? currentUser?.phone ?? t('notSet')}</span>
            </div>
          </div>
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto px-0 py-1 sm:px-0">
        <div className="space-y-4">
          <div className="border border-border/70 bg-card p-4 text-sm text-muted-foreground shadow-token-md">
            <p className="type-chat-kicker text-muted-foreground">
              {t('membership.profileTitle')}
            </p>
            <div className="mt-4 space-y-3">
              <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
                <span className="type-meta text-muted-foreground">{t('membership.currentPlan')}</span>
                <span className="type-chat-kicker text-right text-foreground">{planLabel}</span>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
                <span className="type-meta text-muted-foreground">{t('membership.validFrom')}</span>
                <span className="type-chat-kicker text-right text-foreground">
                  {hasSubscription ? formatDateLabel(subscriptionStartsAt) : t('membership.noMembershipPeriod')}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="type-meta text-muted-foreground">{t('membership.validUntil')}</span>
                <span className="type-chat-kicker text-right text-foreground">
                  {hasSubscription ? formatDateLabel(subscriptionEndsAt) : t('membership.noMembershipPeriod')}
                </span>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            className="type-chat-action w-full justify-between gap-2"
            onClick={handleLogout}
          >
            <span>{t('common:logout')}</span>
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>
    </div>
  )
}

function AccessContent() {
  const { t, i18n } = useTranslation('common')
  const { planLabel, aiQuotaLabel, hasSubscription, subscriptionStartsAt, subscriptionEndsAt } = useMembershipStatus()

  const formatDateLabel = useCallback((value: string | null) => {
    if (!value) return t('membership.noMembershipPeriod')
    return new Intl.DateTimeFormat(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value))
  }, [i18n.language, t])

  return (
    <div className="grid h-full min-h-0 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 xl:border-r xl:border-border/80">
        <div className="space-y-6">
          <div className="border border-border/80 bg-background px-4 py-5">
            <div className="space-y-3">
              <p className="type-chat-kicker text-muted-foreground">
                {t('accessTab')}
              </p>
              <h2 className="type-ed-title-sm text-foreground">
                {t('membership.profileTitle')}
              </h2>
              <p className="type-body-muted max-w-[34ch]">
                {t('membership.profileHint')}
              </p>
            </div>
          </div>

          <div className="border border-border/80 bg-background p-4">
            <div className="space-y-3">
              <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border/80 pb-3 sm:flex-row sm:items-center sm:gap-4">
                <span className="type-meta text-muted-foreground">{t('membership.currentPlan')}</span>
                <span className="type-chat-kicker text-foreground">{planLabel}</span>
              </div>
              <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border/80 pb-3 sm:flex-row sm:items-center sm:gap-4">
                <span className="type-meta text-muted-foreground">{t('membership.currentQuota')}</span>
                <span className="type-chat-kicker text-foreground">{aiQuotaLabel}</span>
              </div>
              <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border/80 pb-3 sm:flex-row sm:items-center sm:gap-4">
                <span className="type-meta text-muted-foreground">{t('membership.reportAccess')}</span>
                <span className="type-chat-kicker text-foreground">
                  {hasSubscription ? t('membership.reportsUnlocked') : t('membership.reportsLocked')}
                </span>
              </div>
              <div className="flex flex-col items-start justify-between gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                <span className="type-meta text-muted-foreground">{t('membership.validPeriod')}</span>
                <span className="type-chat-kicker text-right text-foreground">
                  {hasSubscription
                    ? `${formatDateLabel(subscriptionStartsAt)} — ${formatDateLabel(subscriptionEndsAt)}`
                    : t('membership.noMembershipPeriod')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        <MembershipOverview showHeader={false} compact />
      </div>
    </div>
  )
}
