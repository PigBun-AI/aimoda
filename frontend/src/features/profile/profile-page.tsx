import { useCallback, useEffect, useState } from 'react'
import { BarChart3, FileText, Image as ImageIcon, LogOut, Tags, Ticket, User, UserCog } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { queryClient } from '@/main'
import { Button } from '@/components/ui/button'
import { clearSession, getSessionUser } from '@/features/auth/protected-route'
import { DashboardPage } from '@/features/admin/dashboard-page'
import { ArticlesPage } from '@/features/admin/articles-page'
import { AdminPage } from '@/features/admin/admin-page'
import { RedemptionCodesPage } from '@/features/admin/redemption-codes-page'
import { AdminGalleriesPage } from '@/features/admin/admin-galleries-page'
import { StyleGapPage } from '@/features/admin/style-gap-page'
import { MembershipOverview } from '@/features/membership/membership-overview'
import { useMembershipStatus } from '@/features/membership/use-membership'

type TabId = 'profile' | 'access' | 'dashboard' | 'articles' | 'galleries' | 'styleGaps' | 'users' | 'redemption'

interface TabConfig {
  id: TabId
  labelKey: string
  icon: typeof User
  requiresAdmin?: boolean
}

export function ProfilePage() {
  const { t } = useTranslation('common')
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
    const nextTab = resolveTab(searchParams.get('tab'))
    setActiveTab(current => (current === nextTab ? current : nextTab))
  }, [searchParams, visibleTabs])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'profile': return <ProfileContent />
      case 'access': return <AccessContent />
      case 'dashboard': return <DashboardPage />
      case 'articles': return <ArticlesPage />
      case 'galleries': return <AdminGalleriesPage />
      case 'styleGaps': return <StyleGapPage />
      case 'users': return <AdminPage />
      case 'redemption': return <RedemptionCodesPage />
      default: return <ProfileContent />
    }
  }

  return (
    <section className="space-y-8 font-sans">
      <header className="grid gap-6 border-t border-border pt-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.78fr)] lg:gap-8 lg:pt-6">
        <div className="space-y-3">
          <p className="type-kicker-wide text-muted-foreground">
            {currentUser?.role ?? 'guest'}
          </p>
          <h1 className="type-page-title max-w-[12ch] text-foreground">
            {currentUser?.name ?? t('profileTab')}
          </h1>
        </div>
        <div className="flex flex-col justify-between gap-4 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="type-meta max-w-[32ch] break-all text-muted-foreground">
            {currentUser?.email ?? currentUser?.phone ?? t('notSet')}
          </p>
          <div className="type-meta flex items-center justify-between border-t border-border pt-3 text-muted-foreground">
            <span>{t('profile.accountLabel')}</span>
            <span>{String(visibleTabs.length).padStart(2, '0')}</span>
          </div>
        </div>
      </header>

      <div className="relative">
        <div className="scrollbar-hide flex items-center gap-4 overflow-x-auto border-b border-border font-sans sm:gap-5">
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
                className={[
                  'type-kicker relative flex items-center gap-2 whitespace-nowrap border-b pb-3 transition-colors duration-fast cursor-pointer font-sans',
                  isActive ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <Icon size={14} />
                {t(tab.labelKey)}
              </button>
            )
          })}
        </div>
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent" />
      </div>

      <div className="animate-fade-in font-sans">
        {renderTabContent()}
      </div>
    </section>
  )
}

function ProfileContent() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const currentUser = getSessionUser()

  const handleLogout = useCallback(() => {
    queryClient.clear()
    clearSession()
    navigate('/', { replace: true })
  }, [navigate])

  return (
    <div className="grid max-w-4xl gap-4 font-sans lg:grid-cols-[minmax(0,1.3fr)_minmax(240px,0.7fr)]">
      <section className="border border-border">
        <div className="grid gap-5 border-b border-border px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(150px,0.48fr)]">
          <div className="space-y-2">
            <p className="type-kicker text-muted-foreground">
              {t('profile.accountEyebrow')}
            </p>
            <h2 className="type-section-title text-foreground sm:text-[2rem]">
              {t('profile.accountTitle')}
            </h2>
          </div>

          <div className="flex flex-col justify-end gap-3 border-t border-border pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
            <p className="type-meta text-muted-foreground">
              {currentUser?.role ?? 'guest'}
            </p>
            <div className="type-kicker flex items-center justify-between border-t border-border pt-3 text-muted-foreground">
              <span>{t('profile.fieldsLabel')}</span>
              <span>03</span>
            </div>
          </div>
        </div>

        <div className="px-5">
          <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border py-4 sm:flex-row sm:items-center sm:gap-6">
            <span className="type-meta text-muted-foreground">{t('username')}</span>
            <span className="type-label text-foreground sm:text-right">{currentUser?.name ?? t('notSet')}</span>
          </div>
          <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border py-4 sm:flex-row sm:items-center sm:gap-6">
            <span className="type-meta text-muted-foreground">{t('role')}</span>
            <span className="type-kicker text-foreground sm:text-right">{currentUser?.role ?? 'guest'}</span>
          </div>
          <div className="flex flex-col items-start justify-between gap-1.5 py-4 sm:flex-row sm:items-center sm:gap-6">
            <span className="type-meta text-muted-foreground">{t('email')}</span>
            <span className="type-label break-all text-foreground sm:text-right">{currentUser?.email ?? currentUser?.phone ?? t('notSet')}</span>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <div className="border border-border bg-card p-5 text-sm text-muted-foreground">
          <p className="type-kicker text-muted-foreground">
            {t('membership.profileTitle')}
          </p>
          <p className="type-body-muted mt-3 max-w-[28ch]">
            {t('membership.profileHint')}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="w-full justify-between gap-2"
            onClick={handleLogout}
          >
            <span>{t('common:logout')}</span>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function AccessContent() {
  const { t } = useTranslation('common')
  const { planLabel, aiQuotaLabel, hasSubscription } = useMembershipStatus()

  return (
    <div className="space-y-6">
      <section className="grid gap-4 border border-border px-5 py-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.75fr)] sm:px-6">
        <div className="space-y-3">
          <p className="type-kicker text-muted-foreground">
            {t('accessTab')}
          </p>
          <h2 className="type-section-title text-foreground sm:text-[2.15rem]">
            {t('membership.profileTitle')}
          </h2>
          <p className="type-body-muted max-w-[40ch]">
            {t('membership.profileHint')}
          </p>
        </div>

        <div className="type-meta flex flex-col justify-between gap-4 border-t border-border pt-4 text-muted-foreground lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border pb-3 sm:flex-row sm:items-center sm:gap-4">
            <span>{t('membership.currentPlan')}</span>
            <span className="text-foreground">{planLabel}</span>
          </div>
          <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border pb-3 sm:flex-row sm:items-center sm:gap-4">
            <span>{t('membership.currentQuota')}</span>
            <span className="text-foreground">{aiQuotaLabel}</span>
          </div>
          <div className="flex flex-col items-start justify-between gap-1.5 sm:flex-row sm:items-center sm:gap-4">
            <span>{t('membership.reportAccess')}</span>
            <span className="text-foreground">
              {hasSubscription ? t('membership.reportsUnlocked') : t('membership.reportsLocked')}
            </span>
          </div>
        </div>
      </section>

      <MembershipOverview showHeader={false} compact />
    </div>
  )
}
