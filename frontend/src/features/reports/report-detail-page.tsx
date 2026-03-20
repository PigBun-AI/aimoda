import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useReportDetail } from '@/features/reports/use-report-detail'
import { useReports } from '@/features/reports/use-reports'

function getSafeIframeUrl(url: string): string | null {
  try {
    if (url.startsWith('/')) {
      return url
    }

    const parsedUrl = new URL(url, window.location.origin)
    if (parsedUrl.origin !== window.location.origin) {
      return null
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
  } catch {
    return null
  }
}

export function ReportDetailPage() {
  const { t } = useTranslation('reports')
  const params = useParams()
  const navigate = useNavigate()
  const reportId = params.reportId ?? ''
  const reportQuery = useReportDetail(reportId)
  const reportsQuery = useReports()

  const safeIframeUrl = useMemo(() => {
    if (!reportQuery.data?.iframeUrl) {
      return null
    }
    return getSafeIframeUrl(reportQuery.data.iframeUrl)
  }, [reportQuery.data?.iframeUrl])

  const { prevReport, nextReport } = useMemo(() => {
    const list = reportsQuery.data?.reports ?? []
    const currentIndex = list.findIndex((r) => String(r.id) === reportId)
    return {
      prevReport: currentIndex > 0 ? list[currentIndex - 1] : null,
      nextReport: currentIndex >= 0 && currentIndex < list.length - 1 ? list[currentIndex + 1] : null,
    }
  }, [reportsQuery.data, reportId])

  if (reportQuery.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">{t('common:loading')}</div>
      </div>
    )
  }

  if (!reportQuery.data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-sm mb-4 text-muted-foreground">{t('notFound')}</p>
          <button
            className="text-sm underline text-muted-foreground"
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
      <nav
        className="flex h-12 shrink-0 items-center justify-between border-b px-4 bg-secondary border-border"
      >
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:opacity-70 text-muted-foreground"
            onClick={() => navigate('/reports')}
          >
            <ArrowLeft size={14} />
            {t('backToList')}
          </button>
          <span className="text-xs text-border">|</span>
          <span className="text-sm font-medium truncate max-w-[200px] sm:max-w-[400px]" style={{ color: 'var(--foreground)' }}>
            {reportQuery.data.title}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:opacity-70 disabled:opacity-30 text-muted-foreground"
            disabled={!prevReport}
            onClick={() => prevReport && navigate(`/reports/${prevReport.id}`)}
          >
            <ChevronLeft size={14} />
            {t('previousArticle')}
          </button>
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:opacity-70 disabled:opacity-30 text-muted-foreground"
            disabled={!nextReport}
            onClick={() => nextReport && navigate(`/reports/${nextReport.id}`)}
          >
            {t('nextArticle')}
            <ChevronRight size={14} />
          </button>
        </div>
      </nav>

      <div className="flex-1 overflow-hidden">
        {safeIframeUrl ? (
          <iframe
            className="h-full w-full border-0"
            src={safeIframeUrl}
            title={reportQuery.data.title}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {t('iframeError')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export { getSafeIframeUrl }
