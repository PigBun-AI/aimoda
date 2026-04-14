import { useTranslation } from "react-i18next"

import { SectionIntro } from "@/components/layout/section-intro"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboard } from "@/features/admin/use-dashboard"
import { REDEMPTION_CODE_TYPE_LABELS } from "@/lib/constants"

import type { RedemptionCodeType } from "@/lib/types"

export function DashboardPage() {
  const { t } = useTranslation("admin")
  const { data, isLoading } = useDashboard()

  if (isLoading) {
    return (
      <section className="space-y-6 sm:space-y-8">
        <SectionIntro
          eyebrow="--"
          title={t("dashboard")}
          description={t("dashboardDesc")}
          aside={
            <div className="space-y-3">
              <Skeleton className="h-4 w-24 rounded-none" />
              <Skeleton className="h-10 w-20 rounded-none" />
            </div>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-36 w-full rounded-none" />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-none" />
      </section>
    )
  }

  if (!data) return null

  const maxCount = Math.max(...data.activityTrend.map((day) => day.count), 1)

  return (
    <section className="space-y-6 sm:space-y-8">
      <SectionIntro
        eyebrow={String(data.totalUsers).padStart(2, "0")}
        title={t("dashboard")}
        description={t("dashboardDesc")}
        aside={
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="space-y-2">
              <p className="type-chat-kicker text-muted-foreground">{t("activityTrend")}</p>
              <p className="type-chat-meta max-w-[24ch] text-pretty text-muted-foreground">{t("dashboardDesc")}</p>
            </div>
            <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
              <span>{t("activeSubscriptions")}</span>
              <span className="tabular-nums text-foreground">{String(data.subscriptionStats.active).padStart(2, "0")}</span>
            </div>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-muted-foreground">{t("totalUsers")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="type-ui-title-lg tabular-nums text-foreground">{data.totalUsers}</p>
            <p className="type-chat-meta text-muted-foreground">{t("dashboard")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-muted-foreground">{t("activeSubscriptions")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="type-ui-title-lg tabular-nums text-foreground">{data.subscriptionStats.active}</p>
            <p className="type-chat-meta tabular-nums text-muted-foreground">{data.subscriptionStats.total}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-muted-foreground">{t("todayDAU")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="type-ui-title-lg tabular-nums text-foreground">{data.dauPercent}%</p>
            <p className="type-chat-meta text-muted-foreground">{t("dauShareHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-muted-foreground">{t("redemptionUsage")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.subscriptionStats.byType).map(([type, count]) => (
                <Badge key={type} variant="default" size="sm">
                  {REDEMPTION_CODE_TYPE_LABELS[type as RedemptionCodeType] ?? type}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{t("roleDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(data.roleDistribution).map(([role, count]) => (
                <div key={role} className="border border-border/70 bg-background px-4 py-4">
                  <p className="type-chat-kicker text-muted-foreground">
                    {t(role === "admin" ? "admin" : role === "editor" ? "editor" : "viewer")}
                  </p>
                  <p className="mt-3 type-ui-title-md tabular-nums text-foreground">{count}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{t("activityTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-2 sm:h-44">
              {data.activityTrend.map((day) => {
                const heightPercent = (day.count / maxCount) * 100
                return (
                  <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2" title={`${day.date}: ${day.count}`}>
                    <div
                      className="w-full bg-foreground/80"
                      style={{
                        height: `${heightPercent}%`,
                        minHeight: day.count > 0 ? "4px" : "0px",
                      }}
                    />
                    <span className="type-caption tabular-nums text-muted-foreground">{day.date.slice(5)}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
