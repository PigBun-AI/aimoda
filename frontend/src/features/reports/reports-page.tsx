import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useReports } from '@/features/reports/use-reports'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export function ReportsPage() {
  const { t } = useTranslation('reports')
  const { i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const limit = 12
  const reportsQuery = useReports(page, limit)
  const reports = reportsQuery.data?.reports ?? []
  const totalPages = reportsQuery.data?.totalPages ?? 1

  const statusConfig = {
    published: { label: t('published'), variant: 'primary' as const },
    archived: { label: t('archived'), variant: 'default' as const },
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="font-serif text-2xl sm:text-3xl font-medium text-[var(--text-primary)]">
          {t('title')}
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          {t('subtitle')}
        </p>
      </header>

      {/* Report Cards Grid - Container Query Support */}
      <div className="@container">
        <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4 stagger-children">
          {reportsQuery.isLoading
            ? Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-56 sm:h-64 w-full rounded-[var(--radius-md)]" />
              ))
            : reports.map((report) => {
                const status = statusConfig[report.status as keyof typeof statusConfig]
                return (
                  <Link key={report.id} to={`/reports/${report.id}`} className="group">
                    <Card className="h-full cursor-pointer overflow-hidden">
                      {/* Cover Image - 16:9 aspect ratio */}
                      <div className="relative aspect-video overflow-hidden bg-[var(--bg-tertiary)]">
                        <img
                          src={report.coverImageUrl}
                          alt={report.title}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                            target.nextElementSibling?.classList.remove('hidden')
                          }}
                        />
                        {/* Placeholder when image fails */}
                        <div className="hidden h-full w-full items-center justify-center bg-[var(--bg-tertiary)]">
                          <svg className="h-12 w-12 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        {/* Status Badge */}
                        {status && (
                          <Badge variant={status.variant} className="absolute right-2 top-2 sm:right-3 sm:top-3 text-xs">
                            {status.label}
                          </Badge>
                        )}
                      </div>

                      {/* Card Content */}
                      <div className="p-3 sm:p-4">
                        <h3 className="line-clamp-2 font-medium text-sm sm:text-base text-[var(--text-primary)] transition-colors duration-200 group-hover:text-[var(--gold)]">
                          {report.title}
                        </h3>
                        <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)]">
                          {report.brand} · {report.season}
                        </p>
                        <div className="mt-2 sm:mt-3 flex items-center justify-between">
                          <p className="text-xs text-[var(--text-muted)]">
                            {new Date(report.updatedAt).toLocaleDateString(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                          <span className="text-xs text-[var(--gold)] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            {t('viewDetails')}
                          </span>
                        </div>
                      </div>
                    </Card>
                  </Link>
                )
              })}
        </div>
      </div>

      {/* Pagination - Touch Friendly */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2 sm:gap-4 pt-4 sm:pt-6" aria-label={t('pagination')}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || reportsQuery.isLoading}
            className="min-h-[44px] min-w-[44px] px-3"
            aria-label={t('previousPage')}
          >
            <ChevronLeft className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">{t('previousPage')}</span>
          </Button>

          <span className="text-sm text-[var(--text-muted)] px-2 sm:px-4 tabular-nums">
            <span className="font-medium text-[var(--text-primary)]">{page}</span>
            <span className="mx-1">/</span>
            <span>{totalPages}</span>
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || reportsQuery.isLoading}
            className="min-h-[44px] min-w-[44px] px-3"
            aria-label={t('nextPage')}
          >
            <span className="hidden sm:inline">{t('nextPage')}</span>
            <ChevronRight className="h-4 w-4 sm:ml-1" />
          </Button>
        </nav>
      )}

      {/* Empty State */}
      {reports.length === 0 && !reportsQuery.isLoading && (
        <div className="py-12 sm:py-16 text-center animate-fade-in">
          <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[var(--bg-tertiary)] mb-4">
            <svg className="w-6 h-6 sm:w-8 sm:h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            {t('noReports')}
          </p>
        </div>
      )}
    </section>
  )
}