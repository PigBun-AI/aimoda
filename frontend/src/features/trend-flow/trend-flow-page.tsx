import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageIntro } from '@/components/layout/page-intro'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useTrendFlows } from '@/features/trend-flow/use-trend-flows'
import { ApiError } from '@/lib/api'

function formatFlowDate(date: string, language: string) {
  return new Date(date).toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function TrendFlowPage() {
  const { t, i18n } = useTranslation(['trend-flow', 'common'])
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const limit = 12
  const trendFlowsQuery = useTrendFlows(page, limit, query)
  const trendFlows = trendFlowsQuery.data?.items ?? []
  const totalPages = trendFlowsQuery.data?.totalPages ?? 1
  const totalItems = trendFlowsQuery.data?.total ?? trendFlows.length
  const isLocked = trendFlowsQuery.error instanceof ApiError && trendFlowsQuery.error.status === 403
  const hasSubmittedQuery = query.length > 0
  const fallbackCopy = useMemo(
    () => (item: typeof trendFlows[number]) => t('deck', {
      brand: item.brand,
      window: item.windowLabel,
      date: formatFlowDate(item.updatedAt, i18n.language),
    }),
    [i18n.language, t, trendFlows],
  )

  useEffect(() => {
    setPage(1)
  }, [query])

  return (
    <section className="space-y-7 sm:space-y-8">
      <PageIntro
        eyebrow={String(totalItems).padStart(2, '0')}
        title={t('title')}
        aside={(
          <div className="flex h-full flex-col justify-between gap-4">
            <p className="type-meta max-w-[32ch] text-pretty text-muted-foreground/84">
              {t('subtitle')}
            </p>
            <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
              <span>{t('archiveLabel')}</span>
              <span className="tabular-nums">{String(page).padStart(2, '0')}</span>
            </div>
          </div>
        )}
      />

      <section className="border border-border/80 bg-background px-4 py-4 shadow-token-sm sm:px-5 sm:py-5">
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
              placeholder={t('searchPlaceholder')}
              className="pl-11"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline">
              {t('common:confirm')}
            </Button>
            {hasSubmittedQuery ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchInput('')
                  setQuery('')
                }}
              >
                {t('clearSearch')}
              </Button>
            ) : null}
          </div>
        </form>
      </section>

      {isLocked ? (
        <div className="border border-border/70 bg-card px-5 py-8 shadow-token-md sm:px-6 sm:py-9">
          <div className="mx-auto flex max-w-xl flex-col gap-3.5">
            <p className="type-chat-kicker text-muted-foreground">{t('lockedEyebrow')}</p>
            <h2 className="type-page-title text-foreground">{t('lockedTitle')}</h2>
            <p className="type-body-muted max-w-[44ch] text-pretty">
              {t('lockedBody')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="type-chat-action h-10 px-5">
                <Link to="/profile?tab=access">{t('openMembership')}</Link>
              </Button>
            </div>
          </div>
        </div>
      ) : trendFlows.length === 0 && !trendFlowsQuery.isLoading ? (
        <div className="border border-border/70 bg-card px-5 py-10 text-center shadow-token-md sm:px-6 sm:py-12">
          <div className="mx-auto flex max-w-[22rem] flex-col items-center gap-4">
            <div className="type-chat-kicker border border-border/70 bg-background px-4 py-2 text-muted-foreground">
              {hasSubmittedQuery ? '∅' : '00'}
            </div>
            <p className="type-section-title text-foreground">
              {hasSubmittedQuery ? t('noSearchResultsTitle') : t('emptyTitle')}
            </p>
            <p className="type-body-muted text-pretty text-muted-foreground">
              {hasSubmittedQuery ? t('noSearchResultsBody', { query }) : t('emptyBody')}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          {trendFlowsQuery.isLoading
            ? Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="min-h-[calc(100dvh-16rem)] w-full rounded-none border-t border-border/60" />
              ))
            : trendFlows.map((item, index) => {
                const itemNumber = (page - 1) * limit + index + 1
                const paddedNumber = String(itemNumber).padStart(2, '0')
                const paddedTotal = String(totalItems).padStart(2, '0')
                return (
                  <article
                    key={item.id}
                    className="relative flex min-h-[calc(100dvh-16rem)] flex-col border-t border-border/60 pt-[6vh] md:pt-[8vh]"
                  >
                    <div className="pointer-events-none absolute right-0 top-6 type-meta tabular-nums text-muted-foreground">
                      {paddedNumber} / {paddedTotal}
                    </div>

                    <header className="relative z-10 max-w-full pr-0 md:max-w-[78%] md:pr-[4vw]">
                      <p className="type-chat-kicker text-muted-foreground">{item.brand}</p>
                      <h2 className="mt-4 text-balance text-[clamp(2.25rem,7vw,6rem)] font-bold leading-[0.95] tracking-tight text-foreground">
                        {item.title}
                      </h2>
                      <p className="type-meta mt-6 text-muted-foreground tabular-nums">
                        {item.windowLabel} · {formatFlowDate(item.updatedAt, i18n.language)}
                      </p>
                      {item.leadExcerpt ? (
                        <p className="type-body-muted mt-5 max-w-[48ch] text-pretty text-muted-foreground">
                          {item.leadExcerpt}
                        </p>
                      ) : null}
                    </header>

                    <div className="absolute right-0 top-[38%] hidden md:block">
                      <Button asChild variant="outline" className="type-chat-action h-11 px-6">
                        <Link to={`/trend-flow/${item.id}`} aria-label={`${t('openItem')} — ${item.title}`}>
                          <span>{t('openItem')}</span>
                          <ArrowUpRight className="size-4" strokeWidth={1.6} />
                        </Link>
                      </Button>
                    </div>

                    <div className="mt-6 md:hidden">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/trend-flow/${item.id}`} aria-label={`${t('openItem')} — ${item.title}`}>
                          <span>{t('openItem')}</span>
                          <ArrowUpRight className="size-4" strokeWidth={1.6} />
                        </Link>
                      </Button>
                    </div>

                    <div className="mt-auto pt-[6vh]">
                      <div className="aspect-[21/9] w-full overflow-hidden border border-border/70 bg-background">
                        {item.coverImageUrl ? (
                          <img
                            src={item.coverImageUrl}
                            alt={item.title}
                            className="h-full w-full object-cover object-center"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-6 text-center">
                            <p className="type-chat-kicker max-w-[44ch] text-muted-foreground">
                              {fallbackCopy(item)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5" aria-label={t('pagination')}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
            disabled={page === 1 || trendFlowsQuery.isLoading}
          >
            {t('common:previous')}
          </Button>
          <p className="type-chat-label tabular-nums text-foreground">
            {String(page).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
            disabled={page === totalPages || trendFlowsQuery.isLoading}
          >
            {t('common:next')}
          </Button>
        </nav>
      )}
    </section>
  )
}
