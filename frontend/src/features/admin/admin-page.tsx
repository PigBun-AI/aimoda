import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { SectionIntro } from "@/components/layout/section-intro"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAdminUsers } from "@/features/admin/use-admin-users"

const roleBadgeVariant: Record<string, "primary" | "default" | "error"> = {
  admin: "primary",
  editor: "default",
  viewer: "default",
}

function getPermissions(role: string | undefined): string[] {
  switch (role) {
    case "admin":
      return ["reports:read", "reports:write", "users:manage"]
    case "editor":
      return ["reports:read", "reports:write"]
    case "viewer":
      return ["reports:read"]
    default:
      return []
  }
}

export function AdminPage() {
  const { t } = useTranslation("admin")
  const adminUsersQuery = useAdminUsers()
  const totalUsers = adminUsersQuery.data?.length ?? 0
  const adminCount = useMemo(
    () => adminUsersQuery.data?.filter((user) => user.role === "admin").length ?? 0,
    [adminUsersQuery.data],
  )

  return (
    <section className="space-y-6 sm:space-y-8">
      <SectionIntro
        eyebrow={String(totalUsers).padStart(2, "0")}
        title={t("admin")}
        description={t("userManagementDesc")}
        aside={
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="space-y-2">
              <p className="type-chat-kicker text-muted-foreground">{t("userManagement")}</p>
              <p className="type-chat-meta text-muted-foreground">{t("userManagementDesc")}</p>
            </div>
            <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
              <span>{t("admin")}</span>
              <span className="tabular-nums text-foreground">{String(adminCount).padStart(2, "0")}</span>
            </div>
          </div>
        }
      />

      <Card className="bg-background">
        <CardHeader className="pb-4">
          <CardTitle>{t("userManagement")}</CardTitle>
          <CardDescription>{t("userManagementDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {adminUsersQuery.isLoading
            ? Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full rounded-none" />
              ))
            : adminUsersQuery.data?.map((user) => {
                const userName = user.name || user.email?.split("@")[0] || user.phone || `user-${user.id}`
                const userPermissions = user.permissions || getPermissions(user.role)

                return (
                  <article key={user.id} className="border border-border/70 bg-card px-4 py-4 sm:px-5 sm:py-5">
                    <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="type-label text-foreground">{userName}</p>
                          <Badge variant={roleBadgeVariant[user.role] || "default"} size="sm">
                            {t(user.role === "admin" ? "admin" : user.role === "editor" ? "editor" : "viewer")}
                          </Badge>
                        </div>
                        <p className="type-chat-meta break-all text-muted-foreground">{user.email ?? user.phone ?? "—"}</p>
                      </div>

                      <p className="type-chat-meta tabular-nums text-muted-foreground xl:text-right">
                        {t("recentlyActive")}: {user.lastActiveAt
                          ? new Date(user.lastActiveAt).toLocaleString("zh-CN", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : "-"}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-4">
                      {userPermissions.map((permission) => (
                        <span key={permission} className="type-chat-kicker border border-border/70 px-3 py-2 text-muted-foreground">
                          {permission}
                        </span>
                      ))}
                    </div>
                  </article>
                )
              })}
        </CardContent>
      </Card>
    </section>
  )
}
