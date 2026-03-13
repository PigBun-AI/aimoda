import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboard } from '@/features/admin/use-dashboard'

const typeLabels: Record<string, string> = {
  '1week': '1 week',
  '1month': '1 month',
  '3months': '3 months',
  '1year': '1 year',
}

export function DashboardPage() {
  const { t } = useTranslation('admin')
  const { data, isLoading } = useDashboard()

  if (isLoading) {
    return (
      <section className="space-y-8">
        <div>
          <h1 className="font-serif text-3xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            {t('dashboard')}
          </h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
    <section className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          {t('dashboard')}
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('dashboardDesc')}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>{t('totalUsers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-medium" style={{ color: 'var(--text-primary)' }}>{data.totalUsers}</p>
          </CardContent>
        </Card>

        <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>{t('activeSubscriptions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-medium" style={{ color: 'var(--text-primary)' }}>{data.subscriptionStats.active}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{data.subscriptionStats.total}</p>
          </CardContent>
        </Card>

        <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>{t('todayDAU')}%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-medium" style={{ color: 'var(--text-primary)' }}>{data.dauPercent}%</p>
          </CardContent>
        </Card>

        <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>{t('redemptionUsage')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(data.subscriptionStats.byType).map(([type, count]) => (
                <Badge key={type} className="text-xs">
                  {typeLabels[type] ?? type}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Role distribution */}
      <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('roleDistribution')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {Object.entries(data.roleDistribution).map(([role, count]) => (
              <Badge key={role} className="text-sm px-3 py-1 border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'transparent' }}>
                {t(role === 'admin' ? 'admin' : role === 'editor' ? 'editor' : 'viewer')}: {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Activity trend */}
      <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('activityTrend')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-40">
            {data.activityTrend.map((day) => {
              const heightPercent = (day.count / maxCount) * 100
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1" title={`${day.date}: ${day.count}`}>
                  <div
                    className="w-full rounded-sm transition-all"
                    style={{
                      height: `${heightPercent}%`,
                      minHeight: day.count > 0 ? '4px' : '0px',
                      backgroundColor: 'var(--text-primary)',
                      opacity: 0.7,
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>{data.activityTrend[0]?.date.slice(5)}</span>
            <span>{data.activityTrend[data.activityTrend.length - 1]?.date.slice(5)}</span>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
