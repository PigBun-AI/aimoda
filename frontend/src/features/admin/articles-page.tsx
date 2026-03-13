import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { deleteReport, getAdminReports } from '@/lib/api'

const adminReportsQueryKey = ['admin-reports'] as const

function useAdminReports() {
  return useQuery({
    queryKey: adminReportsQueryKey,
    queryFn: getAdminReports,
  })
}

function useDeleteReport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminReportsQueryKey })
    },
  })
}

export function ArticlesPage() {
  const { t, i18n } = useTranslation('admin')
  const adminReportsQuery = useAdminReports()
  const deleteReportMutation = useDeleteReport()

  function handleDelete(id: string) {
    if (window.confirm(t('deleteConfirm'))) {
      deleteReportMutation.mutate(id)
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          {t('articleManagement')}
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('articleManagementDesc')}
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
            {t('articleList')}
          </CardTitle>
          <CardDescription className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('articleListDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {adminReportsQuery.isLoading
            ? Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-lg" />
              ))
            : adminReportsQuery.data?.map((report) => (
                <div
                  key={report.id}
                  className="rounded-lg p-4 transition-colors hover:bg-[var(--bg-tertiary)]"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div className="flex gap-4">
                    {/* 封面图片 */}
                    <Link
                      to={`/reports/${report.id}`}
                      className="flex-shrink-0"
                    >
                      <div className="w-24 h-24 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800">
                        {report.coverImageUrl ? (
                          <img
                            src={report.coverImageUrl}
                            alt={report.title}
                            className="w-full h-full object-cover hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <ExternalLink className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                    </Link>

                    {/* 报告信息 */}
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/reports/${report.id}`}
                        className="block font-medium hover:underline truncate"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {report.title}
                      </Link>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {report.brand}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          /
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {report.season}
                        </span>
                      </div>
                      <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                        {t('updatedAt')}: {new Date(report.updatedAt).toLocaleString(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link to={`/reports/${report.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {t('common:view')}
                        </Button>
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                        onClick={() => handleDelete(report.id)}
                        disabled={deleteReportMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
          {adminReportsQuery.data?.length === 0 && (
            <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
              {t('noArticles')}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
