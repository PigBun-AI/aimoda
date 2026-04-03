import { useState, useCallback } from 'react'
import { BarChart3, FileText, UserCog, Ticket, User, LogOut, Image as ImageIcon, Tags } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { queryClient } from '@/main'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RedeemDialog } from '@/features/redemption/redeem-dialog'
import { useMySubscription } from '@/features/redemption/use-redeem'
import { getSessionUser, clearSession } from '@/features/auth/protected-route'
import { DashboardPage } from '@/features/admin/dashboard-page'
import { ArticlesPage } from '@/features/admin/articles-page'
import { AdminPage } from '@/features/admin/admin-page'
import { RedemptionCodesPage } from '@/features/admin/redemption-codes-page'
import { AdminGalleriesPage } from '@/features/admin/admin-galleries-page'
import { StyleGapPage } from '@/features/admin/style-gap-page'

type TabId = 'profile' | 'dashboard' | 'articles' | 'galleries' | 'styleGaps' | 'users' | 'redemption'

interface TabConfig {
  id: TabId
  labelKey: string
  icon: typeof User
  requiresAdmin?: boolean
}

export function ProfilePage() {
  const { t } = useTranslation('common')
  const currentUser = getSessionUser()
  const [activeTab, setActiveTab] = useState<TabId>('profile')

  const tabs: TabConfig[] = [
    { id: 'profile', labelKey: 'profileTab', icon: User },
    { id: 'dashboard', labelKey: 'dashboardTab', icon: BarChart3, requiresAdmin: true },
    { id: 'articles', labelKey: 'articlesTab', icon: FileText, requiresAdmin: true },
    { id: 'galleries', labelKey: 'galleriesTab', icon: ImageIcon, requiresAdmin: true },
    { id: 'styleGaps', labelKey: 'styleGapsTab', icon: Tags, requiresAdmin: true },
    { id: 'users', labelKey: 'usersTab', icon: UserCog, requiresAdmin: true },
    { id: 'redemption', labelKey: 'redemptionTab', icon: Ticket, requiresAdmin: true },
  ]

  const visibleTabs = tabs.filter(tab => !tab.requiresAdmin || currentUser?.role === 'admin')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'profile': return <ProfileContent />
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
    <div className="font-sans">
      <div className="relative mb-6">
        <div className="flex items-center gap-1 pb-3 overflow-x-auto border-b border-border scrollbar-hide font-sans">
          {visibleTabs.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-all duration-fast whitespace-nowrap cursor-pointer font-sans',
                  isActive ? 'bg-accent text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <Icon size={16} />
                {t(tab.labelKey)}
              </button>
            )
          })}
        </div>
        {/* 右侧渐变提示 - 仅在内容可滚动时显示 */}
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none" />
      </div>

      <div className="animate-fade-in font-sans">
        {renderTabContent()}
      </div>
    </div>
  )
}

function ProfileContent() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const currentUser = getSessionUser()
  const { data: subscription } = useMySubscription()

  const handleLogout = useCallback(() => {
    queryClient.clear()
    clearSession()
    navigate('/', { replace: true })
  }, [navigate])

  return (
    <div className="max-w-lg font-sans">
      <h2 className="mb-6 text-2xl sm:text-3xl font-medium text-foreground">{t('profileTab')}</h2>

      <div className="space-y-4">
        <div className="flex items-center justify-between py-3 border-b border-border">
          <span className="text-sm text-muted-foreground">{t('username')}</span>
          <span className="text-sm font-medium text-foreground">{currentUser?.name ?? t('notSet')}</span>
        </div>
        <div className="flex items-center justify-between py-3 border-b border-border">
          <span className="text-sm text-muted-foreground">{t('role')}</span>
          <span className="text-sm font-medium uppercase tracking-wider text-foreground">{currentUser?.role ?? 'guest'}</span>
        </div>
        <div className="flex items-center justify-between py-3 border-b border-border">
          <span className="text-sm text-muted-foreground">{t('email')}</span>
          <span className="text-sm font-medium text-foreground">{currentUser?.email ?? t('notSet')}</span>
        </div>
      </div>

      {/* 订阅信息区块 */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('common:subscription')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {subscription ? (
            <>
              <p className="text-sm text-muted-foreground">
                {subscription.status === 'active' ? t('common:subscriptionActive') : t('common:subscriptionInactive')}
              </p>
              {subscription.endsAt && (
                <p className="text-xs text-muted-foreground">
                  {t('common:expiresAt')}: {new Date(subscription.endsAt).toLocaleDateString()}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('common:noSubscription')}</p>
          )}
        </CardContent>
      </Card>

      {/* 操作按钮区块 */}
      <div className="flex flex-col gap-2 mt-4">
        <RedeemDialog />
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={handleLogout}
        >
          <LogOut className="w-4 h-4" />
          {t('common:logout')}
        </Button>
      </div>
    </div>
  )
}
