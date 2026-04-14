import { useEffect, useMemo, useState } from "react"
import { RefreshCw, Search } from "lucide-react"
import { useTranslation } from "react-i18next"

import { SectionIntro } from "@/components/layout/section-intro"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useStyleGapEvents, useStyleGapStats, useStyleGaps, useUpdateStyleGap } from "@/features/admin/use-style-gaps"

import type { StyleGapSignal, StyleGapStatus } from "@/lib/types"

const statusBadgeVariant: Record<StyleGapStatus, "default" | "success" | "warning"> = {
  open: "warning",
  covered: "success",
  ignored: "default",
}

const statusOptions: StyleGapStatus[] = ["open", "covered", "ignored"]
const sortOptions = ["total_hits", "last_seen", "first_seen"] as const
const TEXTAREA_CLASS =
  "min-h-28 w-full resize-y rounded-none border border-input bg-background px-4 py-3 type-ui-body-sm text-foreground placeholder:text-muted-foreground/80 hover:border-foreground/30 focus:border-foreground focus:outline-none"

type FilterState = {
  status: StyleGapStatus
  q: string
  minHits: number
  sort: (typeof sortOptions)[number]
}

function formatDate(value: string | null | undefined, language: string) {
  if (!value) return "-"
  return new Date(value).toLocaleString(language === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function GapRow({
  gap,
  language,
  t,
  onChangeStatus,
  onSaveDetails,
  isUpdating,
}: {
  gap: StyleGapSignal
  language: string
  t: (key: string, options?: Record<string, unknown>) => string
  onChangeStatus: (gap: StyleGapSignal, status: StyleGapStatus) => void
  onSaveDetails: (gap: StyleGapSignal, fields: { linkedStyleName: string; resolutionNote: string; resolvedBy: string }) => void
  isUpdating: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [linkedStyleName, setLinkedStyleName] = useState(gap.linkedStyleName ?? "")
  const [resolutionNote, setResolutionNote] = useState(gap.resolutionNote ?? "")
  const [resolvedBy, setResolvedBy] = useState(gap.resolvedBy ?? "admin")
  const contextJson = useMemo(() => JSON.stringify(gap.latestContext ?? {}, null, 2), [gap.latestContext])
  const eventsQuery = useStyleGapEvents(gap.id, expanded)

  useEffect(() => {
    setLinkedStyleName(gap.linkedStyleName ?? "")
    setResolutionNote(gap.resolutionNote ?? "")
    setResolvedBy(gap.resolvedBy ?? "admin")
  }, [gap.id, gap.linkedStyleName, gap.resolutionNote, gap.resolvedBy])

  return (
    <article className="border border-border/70 bg-card px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-label text-foreground">{gap.queryRaw}</p>
            <Badge variant={statusBadgeVariant[gap.status]} size="sm">
              {t(`admin:styleGapStatus.${gap.status}`)}
            </Badge>
            <Badge variant="default" size="sm">{t("admin:styleGapHits", { count: gap.totalHits })}</Badge>
            <Badge variant="default" size="sm">{t("admin:styleGapSessions", { count: gap.uniqueSessions })}</Badge>
          </div>
          <p className="type-chat-meta text-muted-foreground">
            {t("admin:styleGapNormalized")}: {gap.queryNormalized}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="type-chat-meta text-muted-foreground">{t("admin:styleGapStage")}: {gap.searchStage}</span>
            <span className="type-chat-meta text-muted-foreground">{t("admin:styleGapSource")}: {gap.source}</span>
            <span className="type-chat-meta tabular-nums text-muted-foreground">{t("admin:styleGapLastSeen")}: {formatDate(gap.lastSeenAt, language)}</span>
          </div>
          {gap.linkedStyleName ? (
            <p className="type-chat-meta text-muted-foreground">
              {t("admin:styleGapLinkedStyle")}: {gap.linkedStyleName}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          {statusOptions.map((status) => (
            <Button
              key={status}
              type="button"
              variant={gap.status === status ? "secondary" : "outline"}
              size="sm"
              className="rounded-none"
              loading={isUpdating && gap.status !== status}
              onClick={() => onChangeStatus(gap, status)}
              disabled={isUpdating || gap.status === status}
            >
              {t(`admin:styleGapAction.${status}`)}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" className="rounded-none" onClick={() => setExpanded((value) => !value)}>
            {expanded ? t("common:collapse") : t("common:expand")}
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-4 border-t border-border/60 pt-4 xl:grid-cols-3">
          <div className="space-y-2">
            <p className="type-chat-kicker text-muted-foreground">{t("admin:styleGapContext")}</p>
            <pre className="type-body-xs overflow-x-auto whitespace-pre-wrap break-all border border-border/70 bg-background px-4 py-3 text-foreground">
              {contextJson}
            </pre>
          </div>

          <div className="space-y-3">
            <p className="type-chat-meta tabular-nums text-muted-foreground">{t("admin:styleGapFirstSeen")}: {formatDate(gap.firstSeenAt, language)}</p>
            <p className="type-chat-meta text-muted-foreground">{t("admin:styleGapResolvedBy")}: {gap.resolvedBy || "-"}</p>
            <p className="type-chat-meta tabular-nums text-muted-foreground">{t("admin:styleGapCoveredAt")}: {formatDate(gap.coveredAt, language)}</p>

            <label className="grid gap-2">
              <span className="type-chat-kicker text-muted-foreground">{t("admin:styleGapEditLinkedStyle")}</span>
              <Input
                value={linkedStyleName}
                onChange={(event) => setLinkedStyleName(event.target.value)}
                placeholder={t("admin:styleGapEditLinkedStylePlaceholder")}
              />
            </label>

            <label className="grid gap-2">
              <span className="type-chat-kicker text-muted-foreground">{t("admin:styleGapEditResolvedBy")}</span>
              <Input
                value={resolvedBy}
                onChange={(event) => setResolvedBy(event.target.value)}
                placeholder={t("admin:styleGapEditResolvedByPlaceholder")}
              />
            </label>

            <label className="grid gap-2">
              <span className="type-chat-kicker text-muted-foreground">{t("admin:styleGapResolutionNote")}</span>
              <textarea
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                rows={4}
                className={TEXTAREA_CLASS}
                placeholder={t("admin:styleGapEditResolutionNotePlaceholder")}
              />
            </label>

            <Button
              type="button"
              size="sm"
              className="rounded-none"
              loading={isUpdating}
              onClick={() => onSaveDetails(gap, { linkedStyleName, resolutionNote, resolvedBy })}
              disabled={isUpdating}
            >
              {t("admin:styleGapSaveDetails")}
            </Button>
          </div>

          <div className="space-y-3">
            <p className="type-chat-kicker text-muted-foreground">{t("admin:styleGapRecentEvents")}</p>
            {eventsQuery.isLoading ? (
              <Skeleton className="h-24 w-full rounded-none" />
            ) : eventsQuery.data?.length ? (
              <div className="space-y-2">
                {eventsQuery.data.map((event) => (
                  <div key={event.id} className="border border-border/70 bg-background px-4 py-3">
                    <p className="type-label text-foreground">{event.queryRaw}</p>
                    <p className="mt-1 type-chat-meta text-muted-foreground">{event.searchStage} · {event.source}</p>
                    <p className="mt-1 type-chat-meta tabular-nums text-muted-foreground">{formatDate(event.createdAt, language)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="type-chat-meta text-muted-foreground">{t("admin:styleGapNoEvents")}</p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  )
}

export function StyleGapPage() {
  const { t, i18n } = useTranslation(["admin", "common"])
  const [draft, setDraft] = useState<FilterState>({
    status: "open",
    q: "",
    minHits: 1,
    sort: "total_hits",
  })
  const [filters, setFilters] = useState<FilterState>({
    status: "open",
    q: "",
    minHits: 1,
    sort: "total_hits",
  })

  const styleGapsQuery = useStyleGaps({
    status: filters.status,
    q: filters.q,
    minHits: filters.minHits,
    sort: filters.sort,
    order: "desc",
    limit: 50,
    offset: 0,
  })
  const styleGapStatsQuery = useStyleGapStats()
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

  const handleSaveDetails = (
    gap: StyleGapSignal,
    fields: { linkedStyleName: string; resolutionNote: string; resolvedBy: string },
  ) => {
    updateStyleGapMutation.mutate({
      signalId: gap.id,
      payload: {
        status: gap.status,
        linkedStyleName: fields.linkedStyleName.trim() || undefined,
        resolutionNote: fields.resolutionNote.trim() || undefined,
        resolvedBy: fields.resolvedBy.trim() || undefined,
      },
    })
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      <SectionIntro
        eyebrow={String(styleGapsQuery.data?.total ?? 0).padStart(2, "0")}
        title={t("admin:styleGapsTitle")}
        description={t("admin:styleGapsDesc")}
        aside={
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="space-y-2">
              <p className="type-chat-kicker text-muted-foreground">{t("admin:styleGapsFilters")}</p>
              <p className="type-chat-meta text-muted-foreground">{t("admin:styleGapsFiltersDesc")}</p>
            </div>
            <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
              <span>{t("admin:styleGapStatsOpen")}</span>
              <span className="tabular-nums text-foreground">{String(styleGapStatsQuery.data?.open ?? 0).padStart(2, "0")}</span>
            </div>
          </div>
        }
      />

      <Card className="bg-background">
        <CardHeader className="pb-4">
          <CardTitle>{t("admin:styleGapsFilters")}</CardTitle>
          <CardDescription>{t("admin:styleGapsFiltersDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-2">
            <span className="type-chat-kicker text-muted-foreground">{t("admin:styleGapFilterStatus")}</span>
            <Select
              value={draft.status}
              onValueChange={(value) => setDraft((state) => ({ ...state, status: value as StyleGapStatus }))}
            >
              <SelectTrigger className="rounded-none border-border/80 bg-background">
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
          </label>

          <label className="grid gap-2">
            <span className="type-chat-kicker text-muted-foreground">{t("admin:styleGapFilterQuery")}</span>
            <Input
              value={draft.q}
              onChange={(event) => setDraft((state) => ({ ...state, q: event.target.value }))}
              placeholder={t("admin:styleGapFilterQueryPlaceholder")}
            />
          </label>

          <label className="grid gap-2">
            <span className="type-chat-kicker text-muted-foreground">{t("admin:styleGapFilterMinHits")}</span>
            <Input
              type="number"
              min={1}
              value={draft.minHits}
              onChange={(event) =>
                setDraft((state) => ({
                  ...state,
                  minHits: Number(event.target.value || 1),
                }))
              }
            />
          </label>

          <label className="grid gap-2">
            <span className="type-chat-kicker text-muted-foreground">{t("admin:styleGapFilterSort")}</span>
            <Select
              value={draft.sort}
              onValueChange={(value) => setDraft((state) => ({ ...state, sort: value as FilterState["sort"] }))}
            >
              <SelectTrigger className="rounded-none border-border/80 bg-background">
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
          </label>

          <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-4">
            <Button type="button" onClick={handleSearch} className="rounded-none">
              <Search className="size-4" />
              {t("admin:styleGapApplyFilters")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={() => styleGapsQuery.refetch()}
              disabled={styleGapsQuery.isFetching}
            >
              <RefreshCw className="size-4" />
              {t("admin:styleGapRefresh")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {styleGapStatsQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 w-full rounded-none" />)
        ) : (
          <>
            <Card className="bg-background">
              <CardContent className="space-y-2 pt-5">
                <p className="type-chat-kicker text-muted-foreground">{t("admin:styleGapStatsOpen")}</p>
                <p className="type-ui-title-md tabular-nums text-foreground">{styleGapStatsQuery.data?.open ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="bg-background">
              <CardContent className="space-y-2 pt-5">
                <p className="type-chat-kicker text-muted-foreground">{t("admin:styleGapStatsCovered")}</p>
                <p className="type-ui-title-md tabular-nums text-foreground">{styleGapStatsQuery.data?.covered ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="bg-background">
              <CardContent className="space-y-2 pt-5">
                <p className="type-chat-kicker text-muted-foreground">{t("admin:styleGapStatsIgnored")}</p>
                <p className="type-ui-title-md tabular-nums text-foreground">{styleGapStatsQuery.data?.ignored ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="bg-background">
              <CardContent className="space-y-2 pt-5">
                <p className="type-chat-kicker text-muted-foreground">{t("admin:styleGapStatsRecent")}</p>
                <p className="type-ui-title-md tabular-nums text-foreground">{styleGapStatsQuery.data?.recentNew ?? 0}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="type-ui-title-md text-foreground">{t("admin:styleGapsList")}</h2>
          <p className="type-chat-meta text-muted-foreground">{t("admin:styleGapListCount", { count: styleGapsQuery.data?.total ?? 0 })}</p>
        </div>

        {styleGapsQuery.isLoading ? (
          Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-40 w-full rounded-none" />)
        ) : styleGapsQuery.data?.items.length ? (
          styleGapsQuery.data.items.map((gap) => (
            <GapRow
              key={gap.id}
              gap={gap}
              language={i18n.language}
              t={t}
              onChangeStatus={handleChangeStatus}
              onSaveDetails={handleSaveDetails}
              isUpdating={updateStyleGapMutation.isPending && updateStyleGapMutation.variables?.signalId === gap.id}
            />
          ))
        ) : (
          <Card className="bg-background">
            <CardContent className="px-5 py-10 text-center">
              <p className="type-chat-meta text-muted-foreground">{t("admin:styleGapEmpty")}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}
