import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboard } from '@/features/admin/use-dashboard'

import type { RedemptionCodeType } from '@/lib/types'
import { REDEMPTION_CODE_TYPE_LABELS } from '@/lib/constants'

export function DashboardPage() {
  const { t } = useTranslation('admin')
  const { data, isLoading } = useDashboard()

  if (isLoading) {
    return (
      <section className="space-y-8 font-sans">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-medium mb-2 text-foreground">
            {t('dashboard')}
          </h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      </section>
    )
  }

  if (!data) return null

  const maxCount = Math.max(...data.activityTrend.map((d) => d.count), 1)

  return (
    <section className="space-y-6 sm:space-y-8 font-sans">
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl font-medium mb-2 text-foreground">
          {t('dashboard')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('dashboardDesc')}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">{t('totalUsers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-medium text-foreground">{data.totalUsers}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">{t('activeSubscriptions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-medium text-foreground">{data.subscriptionStats.active}</p>
            <p className="text-xs mt-1 text-muted-foreground">{data.subscriptionStats.total}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">{t('todayDAU')}%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-medium text-foreground">{data.dauPercent}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">{t('redemptionUsage')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(data.subscriptionStats.byType).map(([type, count]) => (
                <Badge key={type} className="text-xs">
                  {REDEMPTION_CODE_TYPE_LABELS[type as RedemptionCodeType] ?? type}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Role distribution */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">{t('roleDistribution')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {Object.entries(data.roleDistribution).map(([role, count]) => (
              <Badge key={role} className="text-sm px-3 py-1 border border-border text-muted-foreground bg-transparent">
                {t(role === 'admin' ? 'admin' : role === 'editor' ? 'editor' : 'viewer')}: {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Activity trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">{t('activityTrend')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-32 sm:h-40">
            {data.activityTrend.map((day) => {
              const heightPercent = (day.count / maxCount) * 100
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1" title={`${day.date}: ${day.count}`}>
                  <div
                    className="w-full rounded-sm transition-all bg-foreground opacity-70"
                    style={{
                      height: `${heightPercent}%`,
                      minHeight: day.count > 0 ? '4px' : '0px',
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{data.activityTrend[0]?.date.slice(5)}</span>
            <span>{data.activityTrend[data.activityTrend.length - 1]?.date.slice(5)}</span>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
