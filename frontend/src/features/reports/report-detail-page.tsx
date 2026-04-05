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
      return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
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
    if (!reportQuery.data?.iframeUrl) {
      return null
    }
    return getSafeIframeUrl(reportQuery.data.iframeUrl)
  }, [reportQuery.data?.iframeUrl])

  const { prevReport, nextReport } = useMemo(() => {
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

  if (!reportQuery.data) {
    if (isLocked) {
      return (
        <div className="flex h-dvh items-center justify-center bg-background px-6">
          <div className="w-full max-w-2xl border border-border bg-card px-8 py-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('lockedEyebrow')}</p>
            <h1 className="mt-3 font-serif text-[2.2rem] leading-[0.94] tracking-[-0.04em] text-foreground">
              {t('lockedTitle')}
            </h1>
            <p className="mt-4 max-w-[42ch] text-sm text-muted-foreground">
              {t('lockedBody')}
            </p>
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

  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="grid shrink-0 gap-5 border-b border-border px-4 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)] sm:px-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate('/reports')}>
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
              <span>{t('backToList')}</span>
            </Button>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {reportQuery.data.brand}
            </span>
          </div>

          <div className="border-t border-border pt-4">
            <h1 className="max-w-[16ch] font-serif text-[2rem] font-medium leading-[0.95] tracking-[-0.04em] text-foreground sm:text-[2.75rem]">
              {reportQuery.data.title}
            </h1>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {reportQuery.data.season}
            </p>
            <p className="text-[11px] uppercase leading-5 tracking-[0.14em] text-muted-foreground">
              {new Date(reportQuery.data.updatedAt).toLocaleDateString(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              variant="ghost"
              size="sm"
              disabled={!prevReport}
              onClick={() => prevReport && navigate(`/reports/${prevReport.id}`)}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              <span>{t('previousArticle')}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!nextReport}
              onClick={() => nextReport && navigate(`/reports/${nextReport.id}`)}
            >
              <span>{t('nextArticle')}</span>
              <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-[#efefeb] p-3 dark:bg-[#0f0f0f] sm:p-4">
        <div className="h-full border border-border bg-background">
          {safeIframeUrl ? (
            <iframe
              className="h-full w-full border-0"
              src={safeIframeUrl}
              title={reportQuery.data.title}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6">
              <p className="max-w-sm text-center text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t('iframeError')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { getSafeIframeUrl }
