import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'

import { PageFrame } from '@/components/layout/page-frame'
import { PageIntro } from '@/components/layout/page-intro'
import { Button } from '@/components/ui/button'
import { RedeemDialog } from '@/features/redemption/redeem-dialog'
import { useReportDetail } from '@/features/reports/use-report-detail'
import { useReports } from '@/features/reports/use-reports'
import { ApiError } from '@/lib/api'

function getSafeIframeUrl(url: string): string | null {
  try {
    if (url.startsWith('/')) {
      return url
    }

    const parsedUrl = new URL(url, window.location.origin)

    if (parsedUrl.origin === window.location.origin) {
      return parsedUrl.pathname + parsedUrl.search + parsedUrl.hash
    }

    if (parsedUrl.hostname.endsWith('.aliyuncs.com')) {
      return url
    }

    return null
  } catch {
    return null
  }
}

export function ReportDetailPage() {
  const { t, i18n } = useTranslation('reports')
  const params = useParams()
  const navigate = useNavigate()
  const reportId = params.reportId ?? ''
  const reportQuery = useReportDetail(reportId)
  const reportsQuery = useReports()
  const isLocked = reportQuery.error instanceof ApiError && reportQuery.error.status === 403

  const safeIframeUrl = useMemo(() => {
    if (reportQuery.data?.iframeUrl == null) {
      return null
    }
    return getSafeIframeUrl(reportQuery.data.iframeUrl)
  }, [reportQuery.data?.iframeUrl])

  const prevNext = useMemo(() => {
    const list = reportsQuery.data?.reports ?? []
    const currentIndex = list.findIndex((report) => String(report.id) === reportId)
    return {
      prevReport: currentIndex > 0 ? list[currentIndex - 1] : null,
      nextReport: currentIndex >= 0 && currentIndex < list.length - 1 ? list[currentIndex + 1] : null,
    }
  }, [reportId, reportsQuery.data])

  if (reportQuery.isLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background">
        <div className="type-chat-kicker border border-border px-4 py-3 text-muted-foreground">
          {t('common:loading')}
        </div>
      </div>
    )
  }

  if (reportQuery.data == null) {
    if (isLocked) {
      return (
        <div className="flex h-full min-h-0 items-center justify-center bg-background px-6">
          <div className="w-full max-w-2xl border border-border bg-card px-8 py-10">
            <p className="type-chat-kicker text-muted-foreground">{t('lockedEyebrow')}</p>
            <h1 className="type-page-title mt-3 text-foreground">
              {t('lockedTitle')}
            </h1>
            <p className="type-body-muted mt-4 max-w-[42ch] text-pretty">{t('lockedBody')}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="ghost">
                <Link to="/profile?tab=access">{t('openMembership')}</Link>
              </Button>
              <RedeemDialog />
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background px-6">
        <div className="max-w-md border border-border px-8 py-10 text-center">
          <p className="type-section-title text-foreground">{t('notFound')}</p>
          <button
            className="type-chat-kicker mt-6 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => navigate('/reports')}
          >
            {t('backToList')}
          </button>
        </div>
      </div>
    )
  }

  const formattedDate = new Date(reportQuery.data.updatedAt).toLocaleDateString(
    i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US',
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    },
  )

  return (
    <PageFrame fullHeight width="wide">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0 border-b border-border/70 pb-4 sm:pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/reports')}>
              <ArrowLeft className="size-4" strokeWidth={1.75} />
              <span>{t('backToList')}</span>
            </Button>
            <div className="flex flex-wrap items-center gap-2 text-right">
              <span className="type-chat-kicker text-muted-foreground">{reportQuery.data.brand}</span>
              <span className="type-chat-kicker border border-border px-2 py-1 text-muted-foreground">Report</span>
            </div>
          </div>

          <div className="pt-4 sm:pt-5">
            <PageIntro
              variant="editorial"
              eyebrow={reportQuery.data.season}
              title={reportQuery.data.title}
              description={`${reportQuery.data.brand} · ${formattedDate}`}
              titleClassName="max-w-[11ch]"
              descriptionClassName="max-w-[44ch]"
              aside={(
                <div className="flex h-full flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
                      <span className="type-chat-kicker text-muted-foreground">Updated</span>
                      <span className="type-chat-meta tabular-nums text-right text-foreground">{formattedDate}</span>
                    </div>
                    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
                      <span className="type-chat-kicker text-muted-foreground">Brand</span>
                      <span className="type-chat-meta text-right text-foreground">{reportQuery.data.brand}</span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="type-chat-kicker text-muted-foreground">Edition</span>
                      <span className="type-chat-meta text-right text-foreground">{reportQuery.data.season}</span>
                    </div>
                  </div>

                  <div className="grid gap-2 border-t border-border/60 pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={prevNext.prevReport == null}
                      onClick={() => {
                        if (prevNext.prevReport) {
                          navigate('/reports/' + String(prevNext.prevReport.id))
                        }
                      }}
                      className="justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        <ChevronLeft className="size-4" strokeWidth={1.75} />
                        <span>{t('previousArticle')}</span>
                      </span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={prevNext.nextReport == null}
                      onClick={() => {
                        if (prevNext.nextReport) {
                          navigate('/reports/' + String(prevNext.nextReport.id))
                        }
                      }}
                      className="justify-between"
                    >
                      <span>{t('nextArticle')}</span>
                      <ChevronRight className="size-4" strokeWidth={1.75} />
                    </Button>
                  </div>
                </div>
              )}
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[216px_minmax(0,1fr)] xl:gap-4">
          <aside className="hidden border border-border bg-background px-4 py-4 xl:flex xl:flex-col xl:justify-between">
            <div className="space-y-4">
              <div className="border-b border-border pb-3">
                <p className="type-chat-kicker text-muted-foreground">Edition</p>
                <p className="mt-2 type-section-title text-foreground">{reportQuery.data.season}</p>
              </div>
              <div className="space-y-2">
                <p className="type-chat-kicker text-muted-foreground">Brand</p>
                <p className="type-chat-title text-foreground">{reportQuery.data.brand}</p>
              </div>
              <div className="space-y-2 border-t border-border pt-3">
                <p className="type-chat-kicker text-muted-foreground">Published</p>
                <p className="type-chat-meta tabular-nums text-foreground">{formattedDate}</p>
              </div>
            </div>
            <p className="type-chat-meta text-muted-foreground">A clean editorial reader with stark black-and-white framing.</p>
          </aside>

          <div className="min-h-[60vh] border border-border bg-background xl:min-h-0">
            {safeIframeUrl ? (
              <iframe className="h-full min-h-[60vh] w-full border-0 bg-white dark:bg-black xl:min-h-0" src={safeIframeUrl} title={reportQuery.data.title} />
            ) : (
              <div className="flex h-full min-h-[60vh] items-center justify-center px-6 xl:min-h-0">
                <p className="type-chat-kicker max-w-sm text-center text-muted-foreground">{t('iframeError')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageFrame>
  )
}

export { getSafeIframeUrl }
