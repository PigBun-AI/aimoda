import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RedeemDialog } from '@/features/redemption/redeem-dialog'
import { useReports } from '@/features/reports/use-reports'
import { ApiError } from '@/lib/api'

function formatReportDate(date: string, language: string) {
  return new Date(date).toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatIssueNumber(page: number, limit: number, index: number) {
  return String((page - 1) * limit + index + 1).padStart(2, '0')
}

function formatReportIssue(page: number, limit: number, index: number) {
  return `#${formatIssueNumber(page, limit, index)}`
}

export function ReportsPage() {
  const { t } = useTranslation('reports')
  const { i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const limit = 12
  const reportsQuery = useReports(page, limit)
  const reports = reportsQuery.data?.reports ?? []
  const totalPages = reportsQuery.data?.totalPages ?? 1
  const totalReports = reportsQuery.data?.total ?? reports.length
  const isLocked = reportsQuery.error instanceof ApiError && reportsQuery.error.status === 403

  return (
    <section className="space-y-8 sm:space-y-10">
      <header className="grid gap-6 border-t border-border pt-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,0.75fr)] lg:gap-8 lg:pt-6">
        <div className="space-y-3">
          <p className="type-kicker-wide text-muted-foreground">
            {String(totalReports).padStart(2, '0')}
          </p>
          <h1 className="type-page-title max-w-[12ch] text-foreground">
            {t('title')}
          </h1>
        </div>
        <div className="flex flex-col justify-between gap-4 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="type-meta max-w-[32ch] text-muted-foreground">
            {t('subtitle')}
          </p>
          <div className="type-meta flex items-center justify-between border-t border-border pt-3 text-muted-foreground">
            <span>{t('archiveLabel')}</span>
            <span>{String(page).padStart(2, '0')}</span>
          </div>
        </div>
      </header>

      {isLocked ? (
        <div className="border border-border bg-card px-6 py-10 sm:px-8 sm:py-12">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <p className="type-kicker-wide text-muted-foreground">{t('lockedEyebrow')}</p>
            <h2 className="type-page-title text-foreground sm:text-[2.6rem]">
              {t('lockedTitle')}
            </h2>
            <p className="type-body-muted max-w-[44ch]">
              {t('lockedBody')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="ghost" className="h-10 px-4 text-[10px] font-semibold uppercase tracking-[0.14em]">
                <Link to="/profile?tab=access">{t('openMembership')}</Link>
              </Button>
              <RedeemDialog />
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
            {reportsQuery.isLoading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-[26rem] w-full rounded-[var(--radius)]" />
                ))
              : reports.map((report, index) => {
                  return (
                    <a
                      key={report.id}
                      href={report.previewUrl || `/reports/${report.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block h-full text-left"
                    >
                      <Card className="h-full overflow-hidden bg-card">
                        <div className="flex h-full flex-col">
                          <div className="relative aspect-video border-b border-border bg-[#f1f1ed] dark:bg-[#141414]">
                            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4 sm:px-6">
                              <span className="type-kicker text-muted-foreground">
                                {report.season}
                              </span>
                              <span className="type-kicker text-muted-foreground">
                                {formatReportIssue(page, limit, index)}
                              </span>
                            </div>

                            <img
                              src={report.coverImageUrl}
                              alt={report.title}
                              className="h-full w-full object-cover object-center transition-transform duration-normal group-hover:scale-[1.012]"
                              loading="lazy"
                              onError={(event) => {
                                const target = event.target as HTMLImageElement
                                target.style.display = 'none'
                                target.nextElementSibling?.classList.remove('hidden')
                                target.nextElementSibling?.classList.add('flex')
                              }}
                            />

                            <div className="hidden h-full w-full items-center justify-center px-8 py-12 text-center sm:px-10 sm:py-14">
                              <div className="space-y-3 border border-border px-6 py-5">
                                <p className="type-kicker text-muted-foreground">
                                  {report.brand}
                                </p>
                                <p className="type-section-title text-foreground">
                                  {report.season}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="border-t border-border px-5 py-5 sm:px-6 sm:py-6">
                            <div className="space-y-4">
                              <div className="flex items-center justify-between gap-4">
                                <p className="type-kicker-wide text-muted-foreground">
                                  {report.brand}
                                </p>
                                <span className="type-kicker text-muted-foreground">
                                  {formatReportDate(report.updatedAt, i18n.language)}
                                </span>
                              </div>

                              <div className="space-y-3 border-t border-border pt-4">
                                <h2 className="font-role-editorial text-[clamp(2rem,1.65rem+1vw,2.8rem)] leading-[0.94] tracking-[0.006em] text-foreground transition-opacity duration-fast group-hover:opacity-75">
                                  {report.title}
                                </h2>
                                <p className="max-w-[42ch] type-body-muted text-foreground/72">
                                  {t('reportDeck', {
                                    brand: report.brand,
                                    season: report.season,
                                    date: formatReportDate(report.updatedAt, i18n.language),
                                  })}
                                </p>
                              </div>

                              <div className="flex items-center justify-between border-t border-border pt-4">
                                <div className="flex items-center gap-3 text-muted-foreground">
                                  <span className="type-kicker">{t('issueLabel')}</span>
                                  <span className="type-kicker text-foreground">{formatReportIssue(page, limit, index)}</span>
                                  <span className="type-kicker">/</span>
                                  <span className="type-kicker">{report.season}</span>
                                </div>
                                <div className="flex items-center gap-2 text-foreground">
                                  <span className="type-ui-label-sm">{t('openReport')}</span>
                                  <ArrowUpRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={1.6} />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </a>
                  )
                })}
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5" aria-label={t('pagination')}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
            disabled={page === 1 || reportsQuery.isLoading}
            className="min-h-[44px] min-w-[44px] px-3"
            aria-label={t('previousPage')}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            <span className="hidden sm:inline">{t('previousPage')}</span>
          </Button>

          <div className="text-center">
            <p className="type-kicker text-muted-foreground">
              {t('pagination')}
            </p>
            <p className="mt-1 text-sm tabular-nums text-foreground">
              {String(page).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
            disabled={page === totalPages || reportsQuery.isLoading}
            className="min-h-[44px] min-w-[44px] px-3"
            aria-label={t('nextPage')}
          >
            <span className="hidden sm:inline">{t('nextPage')}</span>
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </nav>
      )}

      {reports.length === 0 && !reportsQuery.isLoading && (
        <div className="border border-border px-6 py-12 text-center sm:px-8 sm:py-16">
          <div className="mx-auto flex max-w-[18rem] flex-col items-center gap-4">
            <div className="type-kicker-wide border border-border px-4 py-2 text-muted-foreground">
              00
            </div>
            <p className="type-section-title text-foreground">
              {t('noReports')}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
