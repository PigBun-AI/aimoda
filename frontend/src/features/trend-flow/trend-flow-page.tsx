import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Search, X } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteTrendFlows } from "@/features/trend-flow/use-trend-flows";
import { ApiError } from "@/lib/api";
import type { TrendFlowSummary } from "@/lib/types";

const READER_PAGE_SIZE = 4;
const PREVIEW_IFRAME_SCALE = 0.78;

function buildCoverSrcDoc(coverHtml: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        background: transparent;
      }
      body {
        overflow: hidden;
      }
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      img,
      picture,
      video,
      canvas,
      svg {
        max-width: 100%;
      }
    </style>
  </head>
  <body>${coverHtml}</body>
</html>`;
}

function formatFlowDate(date: string, language: string) {
  return new Date(date).toLocaleDateString(
    language === "zh-CN" ? "zh-CN" : "en-US",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
    },
  );
}

export function TrendFlowPage() {
  const { t, i18n } = useTranslation(["trend-flow", "common"]);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  const trendFlowsQuery = useInfiniteTrendFlows(READER_PAGE_SIZE, query);
  const pages = trendFlowsQuery.data?.pages ?? [];
  const trendFlows = useMemo(
    () => pages.flatMap((page) => page.items),
    [pages],
  );
  const totalItems = pages[0]?.total ?? trendFlows.length;
  const activeItemNumber = trendFlows.length
    ? Math.min(activeIndex + 1, totalItems)
    : 0;
  const isLocked =
    trendFlowsQuery.error instanceof ApiError &&
    trendFlowsQuery.error.status === 403;
  const hasSubmittedQuery = query.length > 0;
  const fallbackCopy = useMemo(
    () => (item: TrendFlowSummary) =>
      t("deck", {
        brand: item.brand,
        window: item.windowLabel,
        date: formatFlowDate(item.updatedAt, i18n.language),
      }),
    [i18n.language, t],
  );

  useEffect(() => {
    if (!isSearchOpen) return;
    setSearchInput(query);
  }, [isSearchOpen, query]);

  useEffect(() => {
    setActiveIndex(0);
    if (typeof scrollContainerRef.current?.scrollTo === "function") {
      scrollContainerRef.current.scrollTo({ top: 0 });
    }
  }, [query]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (
      !root ||
      trendFlows.length === 0 ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visibleEntry) return;
        const nextIndex = Number(
          (visibleEntry.target as HTMLElement).dataset.index,
        );
        if (!Number.isNaN(nextIndex)) {
          setActiveIndex(nextIndex);
        }
      },
      {
        root,
        threshold: [0.55, 0.75],
      },
    );

    itemRefs.current.slice(0, trendFlows.length).forEach((item) => {
      if (item) observer.observe(item);
    });

    return () => observer.disconnect();
  }, [trendFlows.length]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    const sentinel = loadMoreRef.current;
    if (
      !root ||
      !sentinel ||
      !trendFlowsQuery.hasNextPage ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          !trendFlowsQuery.isFetchingNextPage
        ) {
          void trendFlowsQuery.fetchNextPage();
        }
      },
      {
        root,
        rootMargin: "60% 0px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    trendFlows.length,
    trendFlowsQuery.fetchNextPage,
    trendFlowsQuery.hasNextPage,
    trendFlowsQuery.isFetchingNextPage,
  ]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(searchInput.trim());
    setIsSearchOpen(false);
  }

  function clearSearch() {
    setSearchInput("");
    setQuery("");
    setIsSearchOpen(false);
  }

  return (
    <section className="relative h-full overflow-hidden bg-background">
      {!isLocked ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex items-start justify-between gap-3 sm:inset-x-5 sm:top-5">
          <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-2">
            <div className="border border-border/70 bg-background/90 px-3 py-2 shadow-token-sm backdrop-blur-md">
              <p className="type-chat-kicker text-muted-foreground">
                {t("readerEyebrow")}
              </p>
              <p className="type-chat-label tabular-nums text-foreground">
                {String(activeItemNumber).padStart(2, "0")} /{" "}
                {String(totalItems).padStart(2, "0")}
              </p>
            </div>

            {hasSubmittedQuery ? (
              <button
                type="button"
                onClick={clearSearch}
                className="flex max-w-[min(22rem,calc(100vw-8rem))] items-center gap-2 border border-border/70 bg-background/90 px-3 py-2 text-left shadow-token-sm backdrop-blur-md transition-colors hover:border-foreground/25"
              >
                <span className="type-chat-meta truncate text-muted-foreground">
                  {t("searchingFor", { query })}
                </span>
                <X className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            className="pointer-events-auto h-10 bg-background/90 px-3 shadow-token-sm backdrop-blur-md sm:px-4"
            onClick={() => setIsSearchOpen(true)}
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">{t("searchEntry")}</span>
          </Button>
        </div>
      ) : null}

      <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
        <DialogContent className="max-w-xl rounded-none border-border/80">
          <DialogHeader>
            <DialogTitle>{t("searchTitle")}</DialogTitle>
            <DialogDescription>{t("searchDescription")}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={submitSearch}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-11"
                autoFocus
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {hasSubmittedQuery ? (
                <Button type="button" variant="ghost" onClick={clearSearch}>
                  {t("clearSearch")}
                </Button>
              ) : null}
              <Button type="submit" variant="outline">
                {t("common:confirm")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {isLocked ? (
        <div className="flex h-full items-center justify-center px-5">
          <div className="w-full max-w-xl border border-border/70 bg-card px-5 py-8 shadow-token-md sm:px-6 sm:py-9">
            <div className="flex flex-col gap-3.5">
              <p className="type-chat-kicker text-muted-foreground">
                {t("lockedEyebrow")}
              </p>
              <h2 className="type-page-title text-foreground">
                {t("lockedTitle")}
              </h2>
              <p className="type-body-muted max-w-[44ch] text-pretty">
                {t("lockedBody")}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  asChild
                  variant="outline"
                  className="type-chat-action h-10 px-5"
                >
                  <Link to="/profile?tab=access">{t("openMembership")}</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : trendFlows.length === 0 && !trendFlowsQuery.isLoading ? (
        <div className="flex h-full items-center justify-center px-5 text-center">
          <div className="flex max-w-[24rem] flex-col items-center gap-4 border border-border/70 bg-card px-5 py-10 shadow-token-md sm:px-6 sm:py-12">
            <div className="type-chat-kicker border border-border/70 bg-background px-4 py-2 text-muted-foreground">
              {hasSubmittedQuery ? "∅" : "00"}
            </div>
            <p className="type-section-title text-foreground">
              {hasSubmittedQuery ? t("noSearchResultsTitle") : t("emptyTitle")}
            </p>
            <p className="type-body-muted text-pretty text-muted-foreground">
              {hasSubmittedQuery
                ? t("noSearchResultsBody", { query })
                : t("emptyBody")}
            </p>
            {hasSubmittedQuery ? (
              <Button type="button" variant="outline" onClick={clearSearch}>
                {t("clearSearch")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollContainerRef}
            className="h-full snap-y snap-mandatory overflow-y-auto scroll-smooth overscroll-contain"
            aria-label={t("readerLabel")}
            tabIndex={0}
          >
            {trendFlowsQuery.isLoading
              ? Array.from({ length: 1 }).map((_, index) => (
                  <Skeleton
                    key={index}
                    className="min-h-full w-full rounded-none border-t border-border/60"
                  />
                ))
              : trendFlows.map((item, index) => {
                  const paddedNumber = String(index + 1).padStart(2, "0");
                  const paddedTotal = String(totalItems).padStart(2, "0");
                  return (
                    <article
                      key={item.id}
                      ref={(element) => {
                        itemRefs.current[index] = element;
                      }}
                      data-index={index}
                      className="relative grid h-full snap-start snap-always grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-t border-border/60 px-4 pb-4 pt-[clamp(4.75rem,10dvh,6.75rem)] sm:px-6 sm:pb-6 lg:px-8"
                    >
                      <div
                        aria-label={`${paddedNumber} of ${paddedTotal}`}
                        className="pointer-events-none absolute right-4 top-[clamp(5.5rem,12dvh,7.5rem)] z-10 type-meta tabular-nums text-muted-foreground sm:right-6"
                      >
                        <span className="block origin-center -rotate-90 whitespace-nowrap">
                          {paddedNumber} / {paddedTotal}
                        </span>
                      </div>

                      <div className="relative z-10 grid gap-5 pr-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-8 md:pr-0">
                        <header className="max-w-[min(64rem,100%)]">
                          <p className="type-chat-kicker text-muted-foreground">
                            {item.brand}
                          </p>
                          <h2 className="mt-3 max-w-[13ch] text-balance text-[clamp(2.15rem,5.8vw,5.4rem)] font-bold leading-[0.94] tracking-tight text-foreground md:mt-4 xl:max-w-[14ch]">
                            {item.title}
                          </h2>
                        </header>
                      </div>

                      <div className="mt-6 md:hidden">
                        <Button asChild variant="outline" size="sm">
                          <a
                            href={item.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`${t("openItem")} — ${item.title}`}
                          >
                            <span>{t("openItem")}</span>
                            <ArrowUpRight
                              className="size-4"
                              strokeWidth={1.6}
                            />
                          </a>
                        </Button>
                      </div>

                      <div className="relative min-h-0 pt-[clamp(1.25rem,3dvh,2.25rem)]">
                        <div className="hidden justify-end pb-[clamp(0.85rem,2dvh,1.35rem)] pr-[clamp(1rem,3vw,3rem)] md:flex">
                          <Button
                            asChild
                            variant="outline"
                            className="type-chat-action h-11 bg-background/90 px-6 shadow-token-sm backdrop-blur-md"
                          >
                            <a
                              href={item.previewUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${t("openItem")} — ${item.title}`}
                            >
                              <span>{t("openItem")}</span>
                              <ArrowUpRight
                                className="size-4"
                                strokeWidth={1.6}
                              />
                            </a>
                          </Button>
                        </div>
                        <div className="relative h-full min-h-0 w-full overflow-hidden border border-border/70 bg-background shadow-token-sm">
                          {item.coverHtml ? (
                            <iframe
                              srcDoc={buildCoverSrcDoc(item.coverHtml)}
                              title={item.title}
                              loading="lazy"
                              sandbox="allow-same-origin"
                              tabIndex={-1}
                              className="pointer-events-none h-full w-full border-0 bg-white dark:bg-black"
                            />
                          ) : (
                            <iframe
                              src={item.previewUrl}
                              title={item.title}
                              loading="lazy"
                              tabIndex={-1}
                              className="pointer-events-none absolute left-1/2 top-0 border-0 bg-white dark:bg-black"
                              style={{
                                width: `${100 / PREVIEW_IFRAME_SCALE}%`,
                                height: `${100 / PREVIEW_IFRAME_SCALE}%`,
                                transform: `translateX(-50%) scale(${PREVIEW_IFRAME_SCALE})`,
                                transformOrigin: "top center",
                              }}
                            />
                          )}
                          {!item.coverImageUrl && !item.coverHtml ? (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/90 to-transparent px-6 py-5 text-center">
                              <p className="type-chat-kicker max-w-[44ch] text-muted-foreground">
                                {fallbackCopy(item)}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
            <div ref={loadMoreRef} className="h-px" aria-hidden="true" />
            {trendFlowsQuery.isFetchingNextPage ? (
              <div className="flex h-24 items-center justify-center">
                <p className="type-chat-kicker text-muted-foreground">
                  {t("loadingMore")}
                </p>
              </div>
            ) : null}
          </div>

          {trendFlows.length > 0 ? (
            <div className="pointer-events-none absolute bottom-5 right-4 z-20 hidden flex-col items-end gap-2 md:flex">
              <div className="h-28 w-px overflow-hidden bg-border/70">
                <div
                  className="w-px bg-foreground transition-[height] duration-normal"
                  style={{
                    height: `${Math.max(
                      8,
                      (activeItemNumber / Math.max(totalItems, 1)) * 100,
                    )}%`,
                  }}
                />
              </div>
              <p className="type-meta tabular-nums text-muted-foreground">
                {String(activeItemNumber).padStart(2, "0")}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
