import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdminUsers } from '@/features/admin/use-admin-users'

const roleBadgeVariant: Record<string, 'primary' | 'default' | 'error'> = {
  admin: 'primary',
  editor: 'default',
  viewer: 'default',
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
    <section className="space-y-6 sm:space-y-8 font-sans">
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl font-medium mb-2 text-foreground">
          {t('admin')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('userManagementDesc')}
        </p>
      </div>

      <Card className="border">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium text-foreground">
            {t('userManagement')}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {t('userManagementDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm font-sans">
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
                    className="rounded-lg p-3 sm:p-4 transition-colors hover:bg-accent bg-secondary"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-medium text-foreground font-sans">
                          {userName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                      <Badge variant={roleBadgeVariant[user.role] || 'default'} size="sm">
                        {t(user.role === 'admin' ? 'admin' : user.role === 'editor' ? 'editor' : 'viewer')}
                      </Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {userPermissions.map((permission) => (
                        <span
                          key={permission}
                          className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {permission}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
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
