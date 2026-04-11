import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ArchiveSplitCard } from '@/components/cards/archive-split-card'
import { Button } from '@/components/ui/button'
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
  const reportFallbackCopy = useMemo(
    () => (report: typeof reports[number]) => t('reportDeck', {
      brand: report.brand,
      season: report.season,
      date: formatReportDate(report.updatedAt, i18n.language),
    }),
    [i18n.language, t],
  )

  return (
    <section className="space-y-9 sm:space-y-12">
      <header className="grid gap-6 border-t border-border/70 pt-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.75fr)] lg:gap-10 lg:pt-8">
        <div className="space-y-3">
          <p className="type-chat-kicker text-muted-foreground/88">
            {String(totalReports).padStart(2, '0')}
          </p>
          <h1 className="type-page-title max-w-[10ch] text-balance text-foreground">
            {t('title')}
          </h1>
        </div>
        <div className="flex flex-col justify-between gap-4 border border-border/60 bg-card px-5 py-5 shadow-token-sm lg:pl-6">
          <p className="type-meta max-w-[32ch] text-muted-foreground/84">
            {t('subtitle')}
          </p>
          <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
            <span>{t('archiveLabel')}</span>
            <span>{String(page).padStart(2, '0')}</span>
          </div>
        </div>
      </header>

      {isLocked ? (
        <div className="border border-border/70 bg-card px-6 py-10 shadow-token-md sm:px-8 sm:py-12">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <p className="type-chat-kicker text-muted-foreground">{t('lockedEyebrow')}</p>
            <h2 className="type-page-title text-foreground sm:text-[2.6rem]">
              {t('lockedTitle')}
            </h2>
            <p className="type-body-muted max-w-[44ch]">
              {t('lockedBody')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="type-chat-action h-10 px-5">
                <Link to="/profile?tab=access">{t('openMembership')}</Link>
              </Button>
              <RedeemDialog />
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid gap-5 sm:gap-6 md:grid-cols-2">
            {reportsQuery.isLoading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-[24rem] w-full rounded-none" />
                ))
              : reports.map((report) => {
                  return (
                    <a
                      key={report.id}
                      href={report.previewUrl || `/reports/${report.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block h-full text-left"
                    >
                      <ArchiveSplitCard
                        mediaClassName="bg-background"
                        media={(
                          <>
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

                              <div className="hidden h-full w-full items-center justify-center px-8 py-12 text-center">
                                <div className="space-y-3 border border-border px-6 py-5">
                                  <p className="type-chat-kicker text-muted-foreground">
                                    {report.brand}
                                  </p>
                                <p className="type-section-title text-foreground">
                                  {report.season}
                                </p>
                              </div>
                            </div>
                          </>
                        )}
                        eyebrow={(
                          <div className="space-y-2">
                            <p className="type-chat-kicker text-muted-foreground">
                              {report.brand}
                            </p>
                            <p className="type-chat-kicker text-muted-foreground">
                              {formatReportDate(report.updatedAt, i18n.language)}
                            </p>
                          </div>
                        )}
                        title={report.title}
                        titleClassName="line-clamp-3"
                        description={report.leadExcerpt || reportFallbackCopy(report)}
                        descriptionClassName="line-clamp-4"
                        footerStart={(
                          <span className="type-chat-kicker text-muted-foreground">
                            {report.season}
                          </span>
                        )}
                        footerEnd={(
                          <div className="flex items-center gap-2 text-foreground">
                            <span className="type-chat-action">{t('openReport')}</span>
                            <ArrowUpRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={1.6} />
                          </div>
                        )}
                      />
                    </a>
                  )
                })}
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-6" aria-label={t('pagination')}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
            disabled={page === 1 || reportsQuery.isLoading}
            className="type-chat-action min-h-[44px] min-w-[44px] px-4"
            aria-label={t('previousPage')}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            <span className="hidden sm:inline">{t('previousPage')}</span>
          </Button>

          <div className="text-center">
            <p className="type-chat-kicker text-muted-foreground">
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
            className="type-chat-action min-h-[44px] min-w-[44px] px-4"
            aria-label={t('nextPage')}
          >
            <span className="hidden sm:inline">{t('nextPage')}</span>
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </nav>
      )}

      {reports.length === 0 && !reportsQuery.isLoading && (
        <div className="border border-border/70 bg-card px-6 py-12 text-center shadow-token-md sm:px-8 sm:py-16">
          <div className="mx-auto flex max-w-[18rem] flex-col items-center gap-4">
            <div className="type-chat-kicker border border-border/70 bg-background px-4 py-2 text-muted-foreground">
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
