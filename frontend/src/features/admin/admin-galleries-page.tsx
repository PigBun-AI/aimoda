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
import { deleteGallery } from "@/features/inspiration/gallery-api"
import { getAdminGalleriesPage, updateAdminGallery } from "@/lib/api"

import type { AdminGallerySummary } from "@/lib/types"

const PAGE_SIZE = 8
const TEXTAREA_CLASS =
  "min-h-32 w-full resize-y rounded-none border border-border/80 bg-background px-4 py-3 type-ui-body-sm text-foreground outline-none transition-colors hover:border-foreground/50 focus:border-foreground"

type GalleryEditorState = {
  id: string
  title: string
  description: string
  category: string
  tagsText: string
  coverUrl: string
  status: string
}

type DeleteTarget = {
  id: string
  title: string
}

function formatDate(value: string, language: string) {
  return new Date(value).toLocaleDateString(language === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function AdminGalleriesPage() {
  const { t, i18n } = useTranslation(["admin", "common"])
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [editor, setEditor] = useState<GalleryEditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const galleriesQuery = useQuery({
    queryKey: ["admin-galleries", page, PAGE_SIZE, query],
    queryFn: () => getAdminGalleriesPage({ page, limit: PAGE_SIZE, q: query || undefined, status: "all" }),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: GalleryEditorState) =>
      updateAdminGallery(payload.id, {
        title: payload.title,
        description: payload.description,
        category: payload.category,
        tags: payload.tagsText.split(",").map((item) => item.trim()).filter(Boolean),
        coverUrl: payload.coverUrl,
        status: payload.status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-galleries"] })
      queryClient.invalidateQueries({ queryKey: ["galleries"] })
      setEditor(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteGallery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-galleries"] })
      queryClient.invalidateQueries({ queryKey: ["galleries"] })
      setDeleteTarget(null)
    },
  })

  useEffect(() => {
    setPage(1)
  }, [query])

  const payload = galleriesQuery.data
  const items = payload?.items ?? []
  const totalPages = payload?.totalPages ?? 1
  const total = payload?.total ?? 0
  const kicker = useMemo(() => String(total).padStart(2, "0"), [total])

  function openEditor(gallery: AdminGallerySummary) {
    setEditor({
      id: gallery.id,
      title: gallery.title,
      description: gallery.description,
      category: gallery.category,
      tagsText: gallery.tags.join(", "),
      coverUrl: gallery.coverUrl,
      status: gallery.status,
    })
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      <SectionIntro
        eyebrow={kicker}
        title={t("common:galleriesTab")}
        description={t("common:galleriesDesc")}
        aside={
          <div className="flex h-full flex-col justify-between gap-4">
            <p className="type-chat-meta max-w-[34ch] text-pretty text-muted-foreground">{t("common:galleriesDesc")}</p>
            <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
              <span>{t("common:galleryList")}</span>
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
              placeholder={t("gallerySearchPlaceholder")}
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
        {galleriesQuery.isLoading
          ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[16rem] w-full rounded-none" />)
          : items.map((gallery) => (
              <article key={gallery.id} className="grid gap-4 border border-border/80 bg-background p-4 sm:grid-cols-[168px_minmax(0,1fr)_auto] sm:p-5">
                <Link to={`/inspiration/${gallery.id}`} className="group block overflow-hidden border border-border/70 bg-background">
                  {gallery.coverUrl ? (
                    <img
                      src={gallery.coverUrl}
                      alt={gallery.title}
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
                    <span className="type-chat-kicker text-muted-foreground">{gallery.category}</span>
                    <span className="type-chat-meta text-muted-foreground">{t("common:imageCount", { count: gallery.imageCount })}</span>
                    <span className="type-chat-meta tabular-nums text-muted-foreground">{formatDate(gallery.updatedAt, i18n.language)}</span>
                  </div>
                  <h2 className="type-ed-title-sm line-clamp-2 text-foreground">{gallery.title}</h2>
                  <p className="type-body-muted line-clamp-4 max-w-[56ch] text-foreground/72">
                    {gallery.description || t("galleryDescriptionFallback")}
                  </p>
                  {gallery.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {gallery.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="type-chat-kicker border border-border/70 px-2 py-1 text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-row gap-2 sm:flex-col sm:items-end">
                  <Button asChild variant="outline" size="sm" className="rounded-none">
                    <Link to={`/inspiration/${gallery.id}`}>
                      <ExternalLink className="size-3.5" />
                      {t("common:view")}
                    </Link>
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={() => openEditor(gallery)}>
                    <PencilLine className="size-3.5" />
                    {t("common:edit")}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" className="rounded-none" onClick={() => setDeleteTarget({ id: gallery.id, title: gallery.title })}>
                    <Trash2 className="size-3.5" />
                    {t("common:delete")}
                  </Button>
                </div>
              </article>
            ))}

        {!galleriesQuery.isLoading && items.length === 0 ? (
          <div className="border border-border/80 px-5 py-10 text-center text-muted-foreground">{t("common:noGalleries")}</div>
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
            <DialogTitle>{t("editGallery")}</DialogTitle>
            <DialogDescription>{t("editGalleryDesc")}</DialogDescription>
          </DialogHeader>

          {editor ? (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="type-chat-kicker text-muted-foreground">{t("galleryTitle")}</span>
                  <Input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} />
                </label>
                <label className="grid gap-2">
                  <span className="type-chat-kicker text-muted-foreground">{t("galleryCategory")}</span>
                  <Input value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value })} />
                </label>
              </div>

              <label className="grid gap-2">
                <span className="type-chat-kicker text-muted-foreground">{t("galleryCoverUrl")}</span>
                <Input value={editor.coverUrl} onChange={(event) => setEditor({ ...editor, coverUrl: event.target.value })} />
              </label>

              <label className="grid gap-2">
                <span className="type-chat-kicker text-muted-foreground">{t("galleryTags")}</span>
                <Input value={editor.tagsText} onChange={(event) => setEditor({ ...editor, tagsText: event.target.value })} placeholder={t("galleryTagsPlaceholder")} />
              </label>

              <label className="grid gap-2">
                <span className="type-chat-kicker text-muted-foreground">{t("galleryDescription")}</span>
                <textarea value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} className={TEXTAREA_CLASS} />
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
              disabled={!editor?.title.trim() || !editor.category.trim()}
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
            <DialogDescription>{t("common:deleteConfirm")}</DialogDescription>
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
