import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { SectionIntro } from "@/components/layout/section-intro"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { REDEMPTION_CODE_TYPE_LABELS } from "@/lib/constants"
import type { RedemptionCodeStatus, RedemptionCodeType } from "@/lib/types"
import { useGenerateCodes, useRedemptionCodes } from "@/features/admin/use-redemption-codes"

export function RedemptionCodesPage() {
  const { t } = useTranslation(["admin", "common"])
  const [type, setType] = useState<RedemptionCodeType>("1month")
  const [count, setCount] = useState("5")
  const codesQuery = useRedemptionCodes()
  const generateMutation = useGenerateCodes()

  const statusConfig: Record<RedemptionCodeStatus, { label: string; variant: "success" | "default" | "error" }> = {
    unused: { label: t("unused"), variant: "success" },
    used: { label: t("used"), variant: "default" },
    expired: { label: t("expired"), variant: "error" },
  }

  const unusedCount = useMemo(
    () => codesQuery.data?.filter((code) => code.status === "unused").length ?? 0,
    [codesQuery.data],
  )

  function handleGenerate() {
    const num = parseInt(count, 10)
    if (num > 0) {
      generateMutation.mutate({ type, count: num })
    }
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      <SectionIntro
        eyebrow={String(codesQuery.data?.length ?? 0).padStart(2, "0")}
        title={t("redemptionCodes")}
        description={t("redemptionCodesDesc")}
        aside={
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="space-y-2">
              <p className="type-chat-kicker text-muted-foreground">{t("generateCodes")}</p>
              <p className="type-chat-meta text-muted-foreground">{t("redemptionCodesDesc")}</p>
            </div>
            <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
              <span>{t("unused")}</span>
              <span className="tabular-nums text-foreground">{String(unusedCount).padStart(2, "0")}</span>
            </div>
          </div>
        }
      />

      <Card className="bg-background">
        <CardHeader className="pb-4">
          <CardTitle>{t("generateCodes")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 xl:grid-cols-[minmax(0,11rem)_minmax(0,7rem)_auto]">
          <Select value={type} onValueChange={(value) => setType(value as RedemptionCodeType)}>
            <SelectTrigger className="rounded-none border-border/80 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1week">1 week</SelectItem>
              <SelectItem value="1month">1 month</SelectItem>
              <SelectItem value="3months">3 months</SelectItem>
              <SelectItem value="1year">1 year</SelectItem>
            </SelectContent>
          </Select>

          <Input
            type="number"
            min="1"
            max="100"
            value={count}
            onChange={(event) => setCount(event.target.value)}
            className="rounded-none border-border/80 bg-background tabular-nums"
            placeholder={t("quantity")}
          />

          <Button onClick={handleGenerate} disabled={generateMutation.isPending} className="rounded-none xl:w-auto">
            {generateMutation.isPending ? t("generating") : t("generateCodes")}
          </Button>

          {generateMutation.isError ? <p className="type-ui-body-sm text-destructive xl:col-span-3">{t("common:error")}</p> : null}
        </CardContent>
      </Card>

      <Card className="bg-background">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {codesQuery.isLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-11 w-full rounded-none" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border/70">
                    <TableHead className="type-chat-kicker text-muted-foreground">{t("redemptionCodes")}</TableHead>
                    <TableHead className="type-chat-kicker text-muted-foreground">{t("columnType")}</TableHead>
                    <TableHead className="type-chat-kicker text-muted-foreground">{t("columnStatus")}</TableHead>
                    <TableHead className="type-chat-kicker text-muted-foreground">{t("columnCreated")}</TableHead>
                    <TableHead className="type-chat-kicker text-muted-foreground">{t("columnUsedBy")}</TableHead>
                    <TableHead className="type-chat-kicker text-muted-foreground">{t("columnUsedAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codesQuery.data?.map((code) => {
                    const status = statusConfig[code.status]
                    return (
                      <TableRow key={code.id} className="border-border/70">
                        <TableCell>
                          <code className="type-data rounded-none border border-border/70 bg-accent px-2 py-1 text-foreground">
                            {code.code}
                          </code>
                        </TableCell>
                        <TableCell className="type-chat-meta text-muted-foreground">{REDEMPTION_CODE_TYPE_LABELS[code.type]}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant} size="sm">{status.label}</Badge>
                        </TableCell>
                        <TableCell className="type-chat-meta tabular-nums text-muted-foreground">
                          {new Date(code.createdAt).toLocaleDateString("zh-CN")}
                        </TableCell>
                        <TableCell className="type-chat-meta text-muted-foreground">{code.usedBy ?? "-"}</TableCell>
                        <TableCell className="type-chat-meta tabular-nums text-muted-foreground">
                          {code.usedAt ? new Date(code.usedAt).toLocaleDateString("zh-CN") : "-"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {codesQuery.data?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="px-5 py-8 text-center">
                        <p className="type-chat-meta text-muted-foreground">{t("noCodes")}</p>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
