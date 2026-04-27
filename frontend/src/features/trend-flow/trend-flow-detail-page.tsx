import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import { PageFrame } from "@/components/layout/page-frame";
import { PageIntro } from "@/components/layout/page-intro";
import { Button } from "@/components/ui/button";
import { useTrendFlowDetail } from "@/features/trend-flow/use-trend-flow-detail";
import { ApiError } from "@/lib/api";

function getSafeIframeUrl(url: string): string | null {
  try {
    if (url.startsWith("/")) {
      return url;
    }

    const parsedUrl = new URL(url, window.location.origin);

    if (parsedUrl.origin === window.location.origin) {
      return parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
    }

    if (parsedUrl.hostname.endsWith(".aliyuncs.com")) {
      return url;
    }

    return null;
  } catch {
    return null;
  }
}

export function TrendFlowDetailPage() {
  const { t, i18n } = useTranslation("trend-flow");
  const params = useParams();
  const navigate = useNavigate();
  const trendFlowId = params.trendFlowId ?? "";
  const trendFlowQuery = useTrendFlowDetail(trendFlowId);
  const isLocked =
    trendFlowQuery.error instanceof ApiError &&
    trendFlowQuery.error.status === 403;

  if (trendFlowQuery.isLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background">
        <div className="type-chat-kicker border border-border px-4 py-3 text-muted-foreground">
          {t("common:loading")}
        </div>
      </div>
    );
  }

  if (trendFlowQuery.data == null) {
    if (isLocked) {
      return (
        <div className="flex h-full min-h-0 items-center justify-center bg-background px-6">
          <div className="w-full max-w-2xl border border-border bg-card px-8 py-10">
            <p className="type-chat-kicker text-muted-foreground">
              {t("lockedEyebrow")}
            </p>
            <h1 className="type-page-title mt-3 text-foreground">
              {t("lockedTitle")}
            </h1>
            <p className="type-body-muted mt-4 max-w-[42ch] text-pretty">
              {t("lockedBody")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="ghost">
                <Link to="/profile?tab=access">{t("openMembership")}</Link>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background px-6">
        <div className="max-w-md border border-border px-8 py-10 text-center">
          <p className="type-section-title text-foreground">{t("notFound")}</p>
          <button
            className="type-chat-kicker mt-6 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => navigate("/trend-flow")}
          >
            {t("backToList")}
          </button>
        </div>
      </div>
    );
  }

  const safeIframeUrl = getSafeIframeUrl(trendFlowQuery.data.iframeUrl);
  const formattedDate = new Date(
    trendFlowQuery.data.updatedAt,
  ).toLocaleDateString(i18n.language === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <PageFrame fullHeight width="wide">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0 border-b border-border/70 pb-4 sm:pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/trend-flow")}
            >
              <ArrowLeft className="size-4" strokeWidth={1.75} />
              <span>{t("backToList")}</span>
            </Button>
            <div className="flex flex-wrap items-center gap-2 text-right">
              <span className="type-chat-kicker text-muted-foreground">
                {trendFlowQuery.data.brand}
              </span>
              <span className="type-chat-kicker border border-border px-2 py-1 text-muted-foreground">
                Trend Flow
              </span>
            </div>
          </div>

          <div className="pt-4 sm:pt-5">
            <PageIntro
              eyebrow={trendFlowQuery.data.windowLabel}
              title={trendFlowQuery.data.title}
              description={
                trendFlowQuery.data.leadExcerpt ||
                t("detailDeck", {
                  brand: trendFlowQuery.data.brand,
                  window: trendFlowQuery.data.windowLabel,
                })
              }
              titleClassName="max-w-[13ch]"
              descriptionClassName="max-w-[44ch]"
              aside={
                <div className="flex h-full flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
                      <span className="type-chat-kicker text-muted-foreground">
                        Brand
                      </span>
                      <span className="type-chat-meta text-right text-foreground">
                        {trendFlowQuery.data.brand}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
                      <span className="type-chat-kicker text-muted-foreground">
                        Window
                      </span>
                      <span className="type-chat-meta text-right text-foreground">
                        {trendFlowQuery.data.windowLabel}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="type-chat-kicker text-muted-foreground">
                        Updated
                      </span>
                      <span className="type-chat-meta tabular-nums text-right text-foreground">
                        {formattedDate}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-2 border-t border-border/60 pt-3">
                    {trendFlowQuery.data.timeline.map((point) => (
                      <div
                        key={`${point.year}-${point.quarter}`}
                        className="flex items-center justify-between border border-border/60 bg-background px-3 py-2"
                      >
                        <span className="type-chat-kicker text-muted-foreground">
                          {point.quarter}
                        </span>
                        <span className="type-chat-meta tabular-nums text-foreground">
                          {point.year}
                        </span>
                      </div>
                    ))}
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={trendFlowQuery.data.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("openRawPreview")}
                      </Link>
                    </Button>
                  </div>
                </div>
              }
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[216px_minmax(0,1fr)] xl:gap-4">
          <aside className="hidden border border-border bg-background px-4 py-4 xl:flex xl:flex-col xl:justify-between">
            <div className="space-y-4">
              <div className="border-b border-border pb-3">
                <p className="type-chat-kicker text-muted-foreground">
                  Timeline
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {trendFlowQuery.data.timeline.map((point) => (
                    <span
                      key={`${point.year}-${point.quarter}-chip`}
                      className="type-chat-kicker border border-border/70 bg-card px-2.5 py-1 text-muted-foreground"
                    >
                      {point.year} {point.quarter}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="type-chat-kicker text-muted-foreground">Brand</p>
                <p className="type-chat-title text-foreground">
                  {trendFlowQuery.data.brand}
                </p>
              </div>
              <div className="space-y-2 border-t border-border pt-3">
                <p className="type-chat-kicker text-muted-foreground">Window</p>
                <p className="type-chat-meta text-foreground">
                  {trendFlowQuery.data.windowLabel}
                </p>
              </div>
            </div>
            <p className="type-chat-meta text-muted-foreground">
              Single-brand trend flow across four consecutive quarters.
            </p>
          </aside>

          <div className="min-h-[60vh] border border-border bg-background xl:min-h-0">
            {safeIframeUrl ? (
              <iframe
                className="h-full min-h-[60vh] w-full border-0 bg-white dark:bg-black xl:min-h-0"
                src={safeIframeUrl}
                title={trendFlowQuery.data.title}
              />
            ) : (
              <div className="flex h-full min-h-[60vh] items-center justify-center px-6 xl:min-h-0">
                <p className="type-chat-kicker max-w-sm text-center text-muted-foreground">
                  {t("iframeError")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
