import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { ReportSummary } from '@/lib/types'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
    onMutate: async (reportId) => {
      // 取消正在进行的查询，防止覆盖我们的乐观更新
      await queryClient.cancelQueries({ queryKey: adminReportsQueryKey })

      // 获取当前缓存的数据
      const previousReports = queryClient.getQueryData<ReportSummary[]>(adminReportsQueryKey)

      // 乐观更新：立即从列表中移除被删除的报告
      queryClient.setQueryData<ReportSummary[]>(adminReportsQueryKey, (old) => {
        if (!old) return old
        return old.filter((report) => report.id !== reportId)
      })

      // 返回上下文以便在失败时回滚
      return { previousReports }
    },
    onError: (_error, _reportId, context) => {
      // 如果删除失败，恢复之前的数据
      if (context?.previousReports) {
        queryClient.setQueryData(adminReportsQueryKey, context.previousReports)
      }
    },
    onSettled: () => {
      // 无论成功或失败，都重新获取数据以确保同步
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
    <section className="space-y-6 sm:space-y-8 font-sans">
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl font-medium mb-2 text-foreground">
          {t('articleManagement')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('articleManagementDesc')}
        </p>
      </div>

      <div className="space-y-4 text-sm">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            {t('articleList')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('articleListDesc')}
          </p>
        </div>
        <div className="space-y-4">
          {adminReportsQuery.isLoading
            ? Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-lg" />
              ))
            : adminReportsQuery.data?.map((report) => (
                <div
                  key={report.id}
                  className="rounded-lg p-4 transition-colors hover:bg-accent bg-secondary"
                >
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* 封面图片 */}
                    <Link
                      to={`/reports/${report.id}`}
                      className="sm:flex-shrink-0"
                    >
                      <div className="w-full h-48 sm:w-24 sm:h-24 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800">
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
                        className="block font-medium hover:underline line-clamp-2 text-sm font-sans text-foreground"
                      >
                        {report.title}
                      </Link>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {report.brand}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          /
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {report.season}
                        </span>
                      </div>
                      <p className="text-xs mt-2 text-muted-foreground font-sans">
                        {t('updatedAt')}: {new Date(report.updatedAt).toLocaleString(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 sm:flex-col flex-shrink-0">
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
                        variant="destructive"
                        size="sm"
                        className="gap-1"
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
            <div className="text-center py-8 text-muted-foreground font-sans">
              {t('noArticles')}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
