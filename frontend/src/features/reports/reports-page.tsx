import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useReports } from '@/features/reports/use-reports'
import { Link } from 'react-router-dom'

const statusMap: Record<string, { label: string; className: string }> = {
  draft: {
    label: '草稿',
    className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
  },
  published: {
    label: '已发布',
    className: 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
  },
  archived: {
    label: '归档',
    className: 'bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-500'
  },
}

export function ReportsPage() {
  const reportsQuery = useReports()

  return (
    <section className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          趋势文章
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          查看最新时尚趋势文章、状态与更新时间。
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2 stagger-children">
        {reportsQuery.isLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-44 w-full rounded-lg" />
            ))
          : reportsQuery.data?.map((report) => {
              const status = statusMap[report.status] || statusMap.draft
              return (
                <Link key={report.id} to={`/reports/${report.id}`}>
                  <Card
                    className="group cursor-pointer border transition-all duration-300 hover:shadow-lg"
                    style={{
                      backgroundColor: 'var(--card-bg)',
                      borderColor: 'var(--border-color)',
                    }}
                  >
                    <CardHeader className="pb-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3
                            className="font-medium group-hover:opacity-80 transition-opacity line-clamp-2"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {report.title}
                          </h3>
                          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                            {report.brand} · {report.season}
                          </p>
                        </div>
                        <Badge className={`${status.className} shrink-0 border-0`}>
                          {status.label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        更新于{' '}
                        {new Date(report.updatedAt).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
      </div>

      {reportsQuery.data?.length === 0 && !reportsQuery.isLoading && (
        <div className="py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            暂无报告，请上传或创建新报告。
          </p>
        </div>
      )}
    </section>
  )
}