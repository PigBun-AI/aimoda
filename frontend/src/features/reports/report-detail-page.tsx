import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'

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
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="border border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t('common:loading')}
        </div>
      </div>
    )
  }

  if (reportQuery.data == null) {
    if (isLocked) {
      return (
        <div className="flex h-dvh items-center justify-center bg-background px-6">
          <div className="w-full max-w-2xl border border-border bg-card px-8 py-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('lockedEyebrow')}</p>
            <h1 className="mt-3 font-serif text-[2.2rem] leading-[0.94] tracking-[-0.04em] text-foreground">
              {t('lockedTitle')}
            </h1>
            <p className="mt-4 max-w-[42ch] text-sm text-muted-foreground">{t('lockedBody')}</p>
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
      <div className="flex h-dvh items-center justify-center bg-background px-6">
        <div className="max-w-md border border-border px-8 py-10 text-center">
          <p className="font-serif text-3xl tracking-[-0.03em] text-foreground">{t('notFound')}</p>
          <button
            className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
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
    <div className="flex h-dvh flex-col bg-background">
      <header className="shrink-0 border-b border-border">
        <div className="grid gap-6 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] lg:gap-10 lg:py-5">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <Button variant="ghost" size="sm" onClick={() => navigate('/reports')}>
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                <span>{t('backToList')}</span>
              </Button>
              <div className="flex flex-wrap items-center gap-2 text-right">
                <span className="type-chat-kicker text-muted-foreground">{reportQuery.data.brand}</span>
                <span className="type-chat-kicker border border-border px-2 py-1 text-muted-foreground">Report</span>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_200px]">
              <div className="space-y-3">
                <p className="type-chat-kicker text-muted-foreground">{reportQuery.data.season}</p>
                <h1 className="type-page-title max-w-[12ch] text-foreground">{reportQuery.data.title}</h1>
              </div>
              <div className="border-l border-border pl-5">
                <p className="type-chat-kicker text-muted-foreground">Updated</p>
                <p className="mt-2 text-sm uppercase tracking-[0.14em] text-foreground">{formattedDate}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="space-y-3">
              <p className="type-chat-kicker text-muted-foreground">Archive note</p>
              <p className="type-body-muted max-w-[30ch]">
                {reportQuery.data.brand} {reportQuery.data.season} · {formattedDate}
              </p>
            </div>

            <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
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
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
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
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 p-3 sm:p-4">
        <div className="grid h-full gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-4">
          <aside className="hidden border border-border bg-background px-5 py-5 lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-5">
              <div className="border-b border-border pb-4">
                <p className="type-chat-kicker text-muted-foreground">Edition</p>
                <p className="mt-2 type-section-title text-foreground">{reportQuery.data.season}</p>
              </div>
              <div className="space-y-2">
                <p className="type-chat-kicker text-muted-foreground">Brand</p>
                <p className="type-chat-title text-foreground">{reportQuery.data.brand}</p>
              </div>
              <div className="space-y-2 border-t border-border pt-4">
                <p className="type-chat-kicker text-muted-foreground">Published</p>
                <p className="type-chat-meta text-foreground">{formattedDate}</p>
              </div>
            </div>
            <p className="type-chat-meta text-muted-foreground">A clean editorial reader with stark black-and-white framing.</p>
          </aside>

          <div className="min-h-0 border border-border bg-background">
            {safeIframeUrl ? (
              <iframe className="h-full w-full border-0 bg-white dark:bg-black" src={safeIframeUrl} title={reportQuery.data.title} />
            ) : (
              <div className="flex h-full items-center justify-center px-6">
                <p className="max-w-sm text-center text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('iframeError')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export { getSafeIframeUrl }
