import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowUpRight, ChevronLeft, ChevronRight, Sparkles, TrendingUp, Camera, Palette, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ArchiveSplitCard } from '@/components/cards/archive-split-card'
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

function getCategoryLabel(category: string | undefined, t: (key: string) => string) {
  const match = CATEGORIES.find((item) => item.value === category)
  return match ? t(match.labelKey) : t('imageArchiveLabel')
}

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
    <section className="space-y-9 sm:space-y-12">
      <header className="grid gap-6 border-t border-border/70 pt-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.75fr)] lg:gap-10 lg:pt-8">
        <div className="space-y-3">
          <p className="type-chat-kicker text-muted-foreground">
            {String(total).padStart(2, '0')}
          </p>
          <h1 className="type-page-title max-w-[10ch] text-balance text-foreground">
            {t('inspiration')}
          </h1>
        </div>
        <div className="flex flex-col justify-between gap-4 border border-border/60 bg-card px-5 py-5 shadow-token-sm lg:pl-6">
          <p className="type-meta max-w-[32ch] text-muted-foreground">
            {t('inspirationSubtitle')}
          </p>
          <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
            <span>{t('imageArchiveLabel')}</span>
            <span>{String(page).padStart(2, '0')}</span>
          </div>
        </div>
      </header>

      <div className="-mx-4 overflow-x-auto border-t border-border/60 px-4 pt-5 sm:mx-0 sm:px-0">
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
                className="type-chat-action gap-2 px-4"
              >
                <Icon className="h-3.5 w-3.5" />
                {t(cat.labelKey)}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="@container">
        <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[24rem] w-full rounded-none" />
              ))
            : galleries.map((gallery, index) => (
                <Link key={gallery.id} to={`/inspiration/${gallery.id}`} className="group block h-full">
                  <ArchiveSplitCard
                    media={(
                      <>
                        {gallery.cover_url ? (
                          <img
                            src={gallery.cover_url}
                            alt={gallery.title}
                            className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.03]"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-accent/60">
                            <Sparkles className="h-10 w-10 text-muted-foreground/40" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-background via-background/84 to-transparent px-4 pb-4 pt-10">
                          <span className="type-chat-kicker text-foreground/82">
                            {getCategoryLabel(gallery.category, t)}
                          </span>
                          <Badge variant="default" className="text-[9px]">
                            {t('imageCount', { count: gallery.image_count })}
                          </Badge>
                        </div>
                      </>
                    )}
                    eyebrow={(
                      <div className="space-y-2">
                        <p className="type-chat-kicker text-muted-foreground">
                          {formatDate(gallery.updated_at, i18n.language)}
                        </p>
                      </div>
                    )}
                    counter={(
                      <span className="type-chat-kicker text-muted-foreground">
                        {formatIssueNumber(index, page)}
                      </span>
                    )}
                    title={gallery.title}
                    titleClassName="line-clamp-3"
                    description={gallery.description || t('inspirationSubtitle')}
                    descriptionClassName="line-clamp-4"
                    chips={(
                      <>
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
                      </>
                    )}
                    footerStart={(
                      <span className="type-chat-kicker text-muted-foreground">
                        {t('imageCount', { count: gallery.image_count })}
                      </span>
                    )}
                    footerEnd={(
                      <div className="flex items-center gap-2 text-foreground">
                        <span className="type-chat-action">{t('openArchive')}</span>
                        <ArrowUpRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={1.6} />
                      </div>
                    )}
                  />
                </Link>
              ))}
        </div>
      </div>

      {!loading && galleries.length === 0 && (
        <div className="border border-border/70 bg-card px-6 py-12 text-center shadow-token-md sm:px-8 sm:py-16">
          <div className="mx-auto flex max-w-[18rem] flex-col items-center gap-4">
            <div className="type-chat-kicker border border-border/70 bg-background px-4 py-2 text-muted-foreground">
              00
            </div>
            <p className="type-section-title text-foreground">
              {t('inspirationEmptyTitle')}
            </p>
            <p className="type-meta text-muted-foreground">
              {t('inspirationEmptyHint')}
            </p>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-6" aria-label="Inspiration pagination">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="type-chat-action min-h-[44px] min-w-[44px] px-4"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            <span className="hidden sm:inline">{t('previous')}</span>
          </Button>
          <div className="text-center">
            <p className="type-chat-kicker text-muted-foreground">
              {t('page')}
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
            className="type-chat-action min-h-[44px] min-w-[44px] px-4"
          >
            <span className="hidden sm:inline">{t('next')}</span>
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </nav>
      )}
    </section>
  )
}
