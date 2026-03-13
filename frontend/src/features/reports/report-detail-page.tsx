import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

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
    const list = reportsQuery.data ?? []
    const currentIndex = list.findIndex((r) => String(r.id) === reportId)
    return {
      prevReport: currentIndex > 0 ? list[currentIndex - 1] : null,
      nextReport: currentIndex >= 0 && currentIndex < list.length - 1 ? list[currentIndex + 1] : null,
    }
  }, [reportsQuery.data, reportId])

  if (reportQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</div>
      </div>
    )
  }

  if (!reportQuery.data) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>未找到对应报告</p>
          <button
            className="text-sm underline"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => navigate('/reports')}
          >
            返回列表
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--bg-primary)' }}>
      <nav
        className="flex h-12 shrink-0 items-center justify-between border-b px-4"
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border-color)',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:opacity-70"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => navigate('/reports')}
          >
            <ArrowLeft size={14} />
            返回列表
          </button>
          <span className="text-xs" style={{ color: 'var(--border-color)' }}>|</span>
          <span className="text-sm font-medium truncate max-w-[400px]" style={{ color: 'var(--text-primary)' }}>
            {reportQuery.data.title}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:opacity-70 disabled:opacity-30"
            style={{ color: 'var(--text-secondary)' }}
            disabled={!prevReport}
            onClick={() => prevReport && navigate(`/reports/${prevReport.id}`)}
          >
            <ChevronLeft size={14} />
            上一篇
          </button>
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:opacity-70 disabled:opacity-30"
            style={{ color: 'var(--text-secondary)' }}
            disabled={!nextReport}
            onClick={() => nextReport && navigate(`/reports/${nextReport.id}`)}
          >
            下一篇
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
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              该报告地址不符合安全加载策略。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export { getSafeIframeUrl }
