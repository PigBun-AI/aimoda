import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Sparkles, TrendingUp, Camera, Palette, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { fetchGalleries, type Gallery } from './gallery-api'

const CATEGORIES = [
  { value: '', labelKey: 'inspirationCategoryAll', icon: Sparkles },
  { value: 'trend', labelKey: 'inspirationCategoryTrend', icon: TrendingUp },
  { value: 'collection', labelKey: 'inspirationCategoryCollection', icon: BookOpen },
  { value: 'street_style', labelKey: 'inspirationCategoryStreetStyle', icon: Camera },
  { value: 'editorial', labelKey: 'inspirationCategoryEditorial', icon: Palette },
  { value: 'inspiration', labelKey: 'inspirationCategoryBoard', icon: Sparkles },
]

const PAGE_SIZE = 12

function formatIssueNumber(index: number, page: number) {
  return String((page - 1) * PAGE_SIZE + index + 1).padStart(2, '0')
}

function formatDate(value: string, language: string) {
  return new Date(value).toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function InspirationPage() {
  const { t, i18n } = useTranslation('common')
  const [searchParams, setSearchParams] = useSearchParams()
  const [galleries, setGalleries] = useState<Gallery[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const category = searchParams.get('category') || ''
  const page = parseInt(searchParams.get('page') || '1', 10)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const loadGalleries = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchGalleries({
        category: category || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setGalleries(data.galleries)
      setTotal(data.total)
    } catch (err) {
      console.error('Failed to load galleries:', err)
    } finally {
      setLoading(false)
    }
  }, [category, page])

  useEffect(() => {
    loadGalleries()
  }, [loadGalleries])

  const setCategory = (cat: string) => {
    const params = new URLSearchParams(searchParams)
    if (cat) params.set('category', cat)
    else params.delete('category')
    params.delete('page')
    setSearchParams(params)
  }

  const setPage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams)
    if (nextPage > 1) params.set('page', String(nextPage))
    else params.delete('page')
    setSearchParams(params)
  }

  return (
    <section className="space-y-8 sm:space-y-10">
      <header className="grid gap-6 border-t border-border pt-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,0.75fr)] lg:gap-8 lg:pt-6">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {String(total).padStart(2, '0')}
          </p>
          <h1 className="max-w-[12ch] font-serif text-[2.25rem] leading-[0.96] font-medium tracking-[-0.04em] text-foreground sm:text-[3.2rem]">
            {t('inspiration')}
          </h1>
        </div>
        <div className="flex flex-col justify-between gap-4 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="max-w-[32ch] text-[11px] uppercase leading-5 tracking-[0.14em] text-muted-foreground">
            {t('inspirationSubtitle')}
          </p>
          <div className="flex items-center justify-between border-t border-border pt-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>Image Archive</span>
            <span>{String(page).padStart(2, '0')}</span>
          </div>
        </div>
      </header>

      <div className="-mx-4 overflow-x-auto border-t border-border px-4 pt-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-2 pb-1 sm:flex-wrap sm:pb-0">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            const isActive = category === cat.value
            return (
              <Button
                key={cat.value}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategory(cat.value)}
                className="gap-2"
              >
                <Icon className="h-3.5 w-3.5" />
                {t(cat.labelKey)}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="@container">
        <div className="grid grid-cols-1 gap-4 sm:gap-5 @md:grid-cols-2 @3xl:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[30rem] w-full rounded-[var(--radius)]" />
              ))
            : galleries.map((gallery, index) => (
                <Link key={gallery.id} to={`/inspiration/${gallery.id}`} className="group block h-full">
                  <Card className="h-full overflow-hidden bg-card">
                    <div className="flex h-full flex-col">
                      <div className="relative aspect-[3/4] overflow-hidden border-b border-border bg-muted">
                        {gallery.cover_url ? (
                          <img
                            src={gallery.cover_url}
                            alt={gallery.title}
                            className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-accent">
                            <Sparkles className="h-10 w-10 text-muted-foreground/40" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-border bg-background/72 px-4 py-3 backdrop-blur">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            {gallery.category || 'archive'}
                          </span>
                          <Badge variant="default" className="text-[9px]">
                            {t('imageCount', { count: gallery.image_count })}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-5 sm:p-6">
                        <div className="space-y-5">
                          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                            <div className="min-w-0 space-y-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                {gallery.source || 'curation'}
                              </p>
                              <h2 className="line-clamp-2 font-serif text-[1.45rem] leading-[0.98] font-medium tracking-[-0.035em] text-foreground transition-opacity duration-fast group-hover:opacity-75 sm:text-[1.8rem]">
                                {gallery.title}
                              </h2>
                            </div>
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              {formatIssueNumber(index, page)}
                            </span>
                          </div>

                          {gallery.description && (
                            <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                              {gallery.description}
                            </p>
                          )}

                          <div className="flex flex-wrap gap-1.5">
                            {gallery.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="default" className="text-[9px]">
                                {tag}
                              </Badge>
                            ))}
                            {gallery.tags.length > 3 && (
                              <Badge variant="default" className="text-[9px]">
                                +{gallery.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="mt-8 flex items-center justify-between border-t border-border pt-4 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                          <span>{formatDate(gallery.updated_at, i18n.language)}</span>
                          <span className="text-foreground transition-opacity duration-fast group-hover:opacity-100 sm:opacity-0">
                            Open Archive
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
        </div>
      </div>

      {!loading && galleries.length === 0 && (
        <div className="border border-border px-6 py-12 text-center sm:px-8 sm:py-16">
          <div className="mx-auto flex max-w-[18rem] flex-col items-center gap-4">
            <div className="border border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              00
            </div>
            <p className="font-serif text-2xl leading-none tracking-[-0.03em] text-foreground">
              {t('inspirationEmptyTitle')}
            </p>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('inspirationEmptyHint')}
            </p>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5" aria-label="Inspiration pagination">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="min-h-[44px] min-w-[44px] px-3"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            <span className="hidden sm:inline">{t('previous')}</span>
          </Button>
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Page
            </p>
            <p className="mt-1 text-sm tabular-nums text-foreground">
              {String(page).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="min-h-[44px] min-w-[44px] px-3"
          >
            <span className="hidden sm:inline">{t('next')}</span>
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </nav>
      )}
    </section>
  )
}
