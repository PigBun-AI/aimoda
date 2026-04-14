import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, PencilLine, Search, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { SectionIntro } from "@/components/layout/section-intro"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { deleteReport, getAdminReportsPage, updateAdminReport } from "@/lib/api"

import type { ReportSummary } from "@/lib/types"

const PAGE_SIZE = 8
const TEXTAREA_CLASS =
  "min-h-32 w-full resize-y rounded-none border border-border/80 bg-background px-4 py-3 type-ui-body-sm text-foreground outline-none transition-colors hover:border-foreground/50 focus:border-foreground"

function formatReportDate(date: string, language: string) {
  return new Date(date).toLocaleDateString(language === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

type ReportEditorState = {
  id: string
  title: string
  brand: string
  season: string
  year: string
  leadExcerpt: string
  coverUrl: string
}

type DeleteTarget = {
  id: string
  title: string
}

export function ArticlesPage() {
  const { t, i18n } = useTranslation(["admin", "common"])
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [editor, setEditor] = useState<ReportEditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const adminReportsQuery = useQuery({
    queryKey: ["admin-reports", page, PAGE_SIZE, query],
    queryFn: () => getAdminReportsPage({ page, limit: PAGE_SIZE, q: query || undefined }),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: ReportEditorState) =>
      updateAdminReport(payload.id, {
        title: payload.title,
        brand: payload.brand,
        season: payload.season,
        year: Number(payload.year),
        leadExcerpt: payload.leadExcerpt,
        coverUrl: payload.coverUrl,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reports"] })
      queryClient.invalidateQueries({ queryKey: ["reports"] })
      setEditor(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reports"] })
      queryClient.invalidateQueries({ queryKey: ["reports"] })
      setDeleteTarget(null)
    },
  })

  useEffect(() => {
    setPage(1)
  }, [query])

  const payload = adminReportsQuery.data
  const items = payload?.items ?? []
  const totalPages = payload?.totalPages ?? 1
  const total = payload?.total ?? 0
  const resultKicker = useMemo(() => String(total).padStart(2, "0"), [total])

  function openEditor(report: ReportSummary) {
    setEditor({
      id: report.id,
      title: report.title,
      brand: report.brand,
      season: report.season,
      year: String((report as ReportSummary & { year?: number }).year ?? ""),
      leadExcerpt: report.leadExcerpt ?? "",
      coverUrl: report.coverImageUrl ?? "",
    })
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      <SectionIntro
        eyebrow={resultKicker}
        title={t("articleManagement")}
        description={t("articleManagementDesc")}
        aside={
          <div className="flex h-full flex-col justify-between gap-4">
            <p className="type-chat-meta max-w-[34ch] text-pretty text-muted-foreground">{t("articleManagementDesc")}</p>
            <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
              <span>{t("articleList")}</span>
              <span className="tabular-nums text-foreground">{String(page).padStart(2, "0")}</span>
            </div>
          </div>
        }
      />

      <section className="border border-border/80 bg-background px-4 py-4 sm:px-5 sm:py-5">
        <form
          className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            setQuery(searchInput.trim())
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("articleSearchPlaceholder")}
              className="pl-11"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" className="rounded-none">
              {t("common:confirm")}
            </Button>
            {query ? (
              <Button
                type="button"
                variant="ghost"
                className="rounded-none"
                onClick={() => {
                  setSearchInput("")
                  setQuery("")
                }}
              >
                {t("clearSearch")}
              </Button>
            ) : null}
          </div>
        </form>
      </section>

      <div className="space-y-4">
        {adminReportsQuery.isLoading
          ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[16rem] w-full rounded-none" />)
          : items.map((report) => (
              <article key={report.id} className="grid gap-4 border border-border/80 bg-background p-4 sm:grid-cols-[168px_minmax(0,1fr)_auto] sm:p-5">
                <Link to={`/reports/${report.id}`} className="group block overflow-hidden border border-border/70 bg-background">
                  {report.coverImageUrl ? (
                    <img
                      src={report.coverImageUrl}
                      alt={report.title}
                      className="h-[13rem] w-full object-cover transition-transform duration-normal group-hover:scale-[1.015] sm:h-full"
                    />
                  ) : (
                    <div className="flex h-[13rem] items-center justify-center text-muted-foreground sm:h-full">
                      <ExternalLink className="size-5" />
                    </div>
                  )}
                </Link>

                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="type-chat-kicker text-muted-foreground">{report.brand}</span>
                    <span className="type-chat-meta text-muted-foreground">{report.season}</span>
                    <span className="type-chat-meta tabular-nums text-muted-foreground">{formatReportDate(report.updatedAt, i18n.language)}</span>
                  </div>
                  <h2 className="type-ed-title-sm line-clamp-2 text-foreground">{report.title}</h2>
                  <p className="type-body-muted line-clamp-4 max-w-[56ch] text-foreground/72">
                    {report.leadExcerpt || t("articleLeadFallback", { brand: report.brand, season: report.season })}
                  </p>
                </div>

                <div className="flex flex-row gap-2 sm:flex-col sm:items-end">
                  <Button asChild variant="outline" size="sm" className="rounded-none">
                    <Link to={`/reports/${report.id}`}>
                      <ExternalLink className="size-3.5" />
                      {t("common:view")}
                    </Link>
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={() => openEditor(report)}>
                    <PencilLine className="size-3.5" />
                    {t("common:edit")}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" className="rounded-none" onClick={() => setDeleteTarget({ id: report.id, title: report.title })}>
                    <Trash2 className="size-3.5" />
                    {t("common:delete")}
                  </Button>
                </div>
              </article>
            ))}

        {!adminReportsQuery.isLoading && items.length === 0 ? (
          <div className="border border-border/80 px-5 py-10 text-center text-muted-foreground">{t("noArticles")}</div>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3 border-t border-border/80 pt-5" aria-label={t("common:page")}>
          <Button
            variant="outline"
            size="sm"
            className="rounded-none"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            {t("common:previous")}
          </Button>
          <p className="type-chat-meta tabular-nums text-muted-foreground">
            {String(page).padStart(2, "0")} / {String(totalPages).padStart(2, "0")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="rounded-none"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            {t("common:next")}
          </Button>
        </nav>
      ) : null}

      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-w-2xl rounded-none border-border/80">
          <DialogHeader>
            <DialogTitle>{t("editArticle")}</DialogTitle>
            <DialogDescription>{t("editArticleDesc")}</DialogDescription>
          </DialogHeader>

          {editor ? (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="type-chat-kicker text-muted-foreground">{t("articleTitle")}</span>
                  <Input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} />
                </label>
                <label className="grid gap-2">
                  <span className="type-chat-kicker text-muted-foreground">{t("articleBrand")}</span>
                  <Input value={editor.brand} onChange={(event) => setEditor({ ...editor, brand: event.target.value })} />
                </label>
                <label className="grid gap-2">
                  <span className="type-chat-kicker text-muted-foreground">{t("articleSeason")}</span>
                  <Input value={editor.season} onChange={(event) => setEditor({ ...editor, season: event.target.value })} />
                </label>
                <label className="grid gap-2">
                  <span className="type-chat-kicker text-muted-foreground">{t("articleYear")}</span>
                  <Input value={editor.year} onChange={(event) => setEditor({ ...editor, year: event.target.value })} inputMode="numeric" />
                </label>
              </div>

              <label className="grid gap-2">
                <span className="type-chat-kicker text-muted-foreground">{t("articleCoverUrl")}</span>
                <Input value={editor.coverUrl} onChange={(event) => setEditor({ ...editor, coverUrl: event.target.value })} />
              </label>

              <label className="grid gap-2">
                <span className="type-chat-kicker text-muted-foreground">{t("articleLead")}</span>
                <textarea
                  value={editor.leadExcerpt}
                  onChange={(event) => setEditor({ ...editor, leadExcerpt: event.target.value })}
                  className={TEXTAREA_CLASS}
                />
              </label>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setEditor(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              className="rounded-none"
              loading={updateMutation.isPending}
              onClick={() => editor && updateMutation.mutate(editor)}
              disabled={!editor?.title.trim() || !editor.brand.trim() || !editor.season.trim() || !editor.year.trim()}
            >
              {t("common:save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-lg rounded-none border-border/80">
          <DialogHeader>
            <DialogTitle>{t("common:delete")}</DialogTitle>
            <DialogDescription>{t("deleteConfirm")}</DialogDescription>
          </DialogHeader>
          {deleteTarget ? <p className="type-chat-meta text-muted-foreground">{deleteTarget.title}</p> : null}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setDeleteTarget(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              className="rounded-none"
              loading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {t("common:delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
