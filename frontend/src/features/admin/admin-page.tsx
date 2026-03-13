import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdminUsers } from '@/features/admin/use-admin-users'

const roleBadgeClass: Record<string, string> = {
  admin: 'bg-gray-900 text-white dark:bg-white dark:text-gray-900',
  editor: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  viewer: 'bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-500',
}

function getPermissions(role: string | undefined): string[] {
  switch (role) {
    case 'admin':
      return ['reports:read', 'reports:write', 'users:manage']
    case 'editor':
      return ['reports:read', 'reports:write']
    case 'viewer':
      return ['reports:read']
    default:
      return []
  }
}

export function AdminPage() {
  const { t } = useTranslation('admin')
  const adminUsersQuery = useAdminUsers()

  return (
    <section className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          {t('admin')}
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('userManagementDesc')}
        </p>
      </div>

      <Card
        className="border"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--border-color)'
        }}
      >
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
            {t('userManagement')}
          </CardTitle>
          <CardDescription className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('userManagementDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {adminUsersQuery.isLoading
            ? Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-lg" />
              ))
            : adminUsersQuery.data?.map((user) => {
                const userName = user.name || user.email.split('@')[0]
                const userPermissions = user.permissions || getPermissions(user.role)
                return (
                  <div
                    key={user.id}
                    className="rounded-lg p-4 transition-colors hover:bg-[var(--bg-tertiary)]"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {userName}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {user.email}
                        </p>
                      </div>
                      <Badge
                        className={`${roleBadgeClass[user.role] || ''} border-0 text-xs`}
                      >
                        {t(user.role === 'admin' ? 'admin' : user.role === 'editor' ? 'editor' : 'viewer')}
                      </Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {userPermissions.map((permission) => (
                        <span
                          key={permission}
                          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs"
                          style={{
                            borderColor: 'var(--border-color)',
                            color: 'var(--text-muted)'
                          }}
                        >
                          {permission}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t('recentlyActive')}: {user.lastActiveAt
                        ? new Date(user.lastActiveAt).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '-'}
                    </p>
                  </div>
                )
              })}
        </CardContent>
      </Card>
    </section>
  )
}
