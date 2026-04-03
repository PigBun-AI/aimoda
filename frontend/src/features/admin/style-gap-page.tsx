import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useStyleGaps, useUpdateStyleGap } from '@/features/admin/use-style-gaps'
import type { StyleGapSignal, StyleGapStatus } from '@/lib/types'

const statusBadgeVariant: Record<StyleGapStatus, 'default' | 'success' | 'warning'> = {
  open: 'warning',
  covered: 'success',
  ignored: 'default',
}

const statusOptions: StyleGapStatus[] = ['open', 'covered', 'ignored']
const sortOptions = ['total_hits', 'last_seen', 'first_seen'] as const

type FilterState = {
  status: StyleGapStatus
  q: string
  minHits: number
  sort: (typeof sortOptions)[number]
}

function formatDate(value: string | null | undefined, language: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function GapRow({
  gap,
  language,
  t,
  onChangeStatus,
  isUpdating,
}: {
  gap: StyleGapSignal
  language: string
  t: (key: string, options?: Record<string, unknown>) => string
  onChangeStatus: (gap: StyleGapSignal, status: StyleGapStatus) => void
  isUpdating: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const contextJson = useMemo(() => JSON.stringify(gap.latestContext ?? {}, null, 2), [gap.latestContext])

  return (
    <div className="rounded-lg border border-border bg-secondary/60 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{gap.queryRaw}</p>
            <Badge variant={statusBadgeVariant[gap.status]} size="sm">
              {t(`admin:styleGapStatus.${gap.status}`)}
            </Badge>
            <Badge variant="default" size="sm">{t('admin:styleGapHits', { count: gap.totalHits })}</Badge>
            <Badge variant="default" size="sm">{t('admin:styleGapSessions', { count: gap.uniqueSessions })}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('admin:styleGapNormalized')}: {gap.queryNormalized}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{t('admin:styleGapStage')}: {gap.searchStage}</span>
            <span>{t('admin:styleGapSource')}: {gap.source}</span>
            <span>{t('admin:styleGapLastSeen')}: {formatDate(gap.lastSeenAt, language)}</span>
          </div>
          {gap.linkedStyleName ? (
            <p className="text-xs text-muted-foreground">
              {t('admin:styleGapLinkedStyle')}: {gap.linkedStyleName}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          {statusOptions.map((status) => (
            <Button
              key={status}
              type="button"
              variant={gap.status === status ? 'secondary' : 'outline'}
              size="sm"
              loading={isUpdating && gap.status !== status}
              onClick={() => onChangeStatus(gap, status)}
              disabled={isUpdating || gap.status === status}
            >
              {t(`admin:styleGapAction.${status}`)}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('common:collapse') : t('common:expand')}
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-4 rounded-lg border border-border bg-background/70 p-4 text-sm md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('admin:styleGapContext')}
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-secondary p-3 text-xs text-foreground">
              {contextJson}
            </pre>
          </div>
          <div className="space-y-3 text-xs text-muted-foreground">
            <p>{t('admin:styleGapFirstSeen')}: {formatDate(gap.firstSeenAt, language)}</p>
            <p>{t('admin:styleGapResolvedBy')}: {gap.resolvedBy || '-'}</p>
            <p>{t('admin:styleGapCoveredAt')}: {formatDate(gap.coveredAt, language)}</p>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('admin:styleGapResolutionNote')}
              </p>
              <p className="rounded-md bg-secondary p-3 text-xs text-foreground">
                {gap.resolutionNote || '-'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function StyleGapPage() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const [draft, setDraft] = useState<FilterState>({
    status: 'open',
    q: '',
    minHits: 1,
    sort: 'total_hits',
  })
  const [filters, setFilters] = useState<FilterState>({
    status: 'open',
    q: '',
    minHits: 1,
    sort: 'total_hits',
  })

  const styleGapsQuery = useStyleGaps({
    status: filters.status,
    q: filters.q,
    minHits: filters.minHits,
    sort: filters.sort,
    order: 'desc',
    limit: 50,
    offset: 0,
  })
  const updateStyleGapMutation = useUpdateStyleGap()

  const handleSearch = () => {
    setFilters({
      status: draft.status,
      q: draft.q.trim(),
      minHits: Math.max(1, draft.minHits || 1),
      sort: draft.sort,
    })
  }

  const handleChangeStatus = (gap: StyleGapSignal, status: StyleGapStatus) => {
    updateStyleGapMutation.mutate({
      signalId: gap.id,
      payload: { status },
    })
  }

  return (
    <section className="space-y-6 sm:space-y-8 font-sans">
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl font-medium mb-2 text-foreground">
          {t('admin:styleGapsTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('admin:styleGapsDesc')}
        </p>
      </div>

      <Card className="border">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium text-foreground">
            {t('admin:styleGapsFilters')}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {t('admin:styleGapsFiltersDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('admin:styleGapFilterStatus')}</p>
            <Select
              value={draft.status}
              onValueChange={(value) => setDraft((state) => ({ ...state, status: value as StyleGapStatus }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`admin:styleGapStatus.${status}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('admin:styleGapFilterQuery')}</p>
            <Input
              value={draft.q}
              onChange={(event) => setDraft((state) => ({ ...state, q: event.target.value }))}
              placeholder={t('admin:styleGapFilterQueryPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('admin:styleGapFilterMinHits')}</p>
            <Input
              type="number"
              min={1}
              value={draft.minHits}
              onChange={(event) => setDraft((state) => ({
                ...state,
                minHits: Number(event.target.value || 1),
              }))}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('admin:styleGapFilterSort')}</p>
            <Select
              value={draft.sort}
              onValueChange={(value) => setDraft((state) => ({ ...state, sort: value as FilterState['sort'] }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((sort) => (
                  <SelectItem key={sort} value={sort}>
                    {t(`admin:styleGapSort.${sort}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-4">
            <Button type="button" onClick={handleSearch} className="min-w-[120px]">
              <Search className="h-4 w-4" />
              {t('admin:styleGapApplyFilters')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => styleGapsQuery.refetch()}
              disabled={styleGapsQuery.isFetching}
            >
              <RefreshCw className="h-4 w-4" />
              {t('admin:styleGapRefresh')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-foreground">{t('admin:styleGapsList')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('admin:styleGapListCount', { count: styleGapsQuery.data?.total ?? 0 })}
            </p>
          </div>
        </div>

        {styleGapsQuery.isLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-36 w-full rounded-lg" />
          ))
        ) : styleGapsQuery.data?.items.length ? (
          styleGapsQuery.data.items.map((gap) => (
            <GapRow
              key={gap.id}
              gap={gap}
              language={i18n.language}
              t={t}
              onChangeStatus={handleChangeStatus}
              isUpdating={updateStyleGapMutation.isPending && updateStyleGapMutation.variables?.signalId === gap.id}
            />
          ))
        ) : (
          <Card className="border">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {t('admin:styleGapEmpty')}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}
