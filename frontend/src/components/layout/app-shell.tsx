import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Globe,
  History,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageCircle,
  Moon,
  PanelLeftClose,
  PencilLine,
  Pin,
  PinOff,
  Sparkles,
  Sun,
  Trash2,
  X,
  Heart,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageFrame } from "@/components/layout/page-frame";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSessionStore } from "@/features/chat/session-store";
import { useChatLayoutStore } from "@/features/chat/chat-layout-store";
import { useLoginDialog } from "@/features/auth/auth-store";
import { LoginDialog } from "@/features/auth/login-dialog";
import { useMembershipStatus } from "@/features/membership/use-membership";

import { getSessionUser } from "@/features/auth/protected-route";
import { useThemeStore } from "@/lib/theme-store";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/api";
import { shouldPinAppShellSidebar } from "@/components/layout/app-shell-layout";

const SIDEBAR_WIDTH = 240;
const SIDEBAR_ICON_BUTTON_CLASS =
  "control-icon-sm flex items-center justify-center rounded-none border border-border/60 bg-background text-muted-foreground shadow-token-sm transition-[background-color,border-color,color,transform] cursor-pointer hover:-translate-y-px hover:border-foreground/20 hover:bg-card hover:text-foreground";
const SIDEBAR_UTILITY_BUTTON_CLASS =
  "type-chat-action control-pill-md flex items-center justify-between gap-3 rounded-none border border-border/70 bg-background text-muted-foreground shadow-token-sm transition-[background-color,border-color,color,transform] cursor-pointer hover:-translate-y-px hover:border-foreground/20 hover:bg-card hover:text-foreground";
const SIDEBAR_SESSION_ACTION_CLASS =
  "flex size-6 items-center justify-center rounded-none border border-transparent transition-[background-color,border-color,color] hover:border-border/70 hover:bg-accent/70";

function formatSidebarSessionTimestamp(value: string, language: string) {
  const locale = language === "zh-CN" ? "zh-CN" : "en-US";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const datePart = new Intl.DateTimeFormat(locale, {
    month: language === "zh-CN" ? "2-digit" : "short",
    day: "2-digit",
  }).format(date);

  const timePart = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: language !== "zh-CN",
  }).format(date);

  return `${datePart} · ${timePart}`;
}

type SessionDialogState = {
  sessionId: string;
  title: string;
};

export function AppShell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = getSessionUser();
  const currentUserId = currentUser?.id ?? null;
  const currentRouteSessionId = useMemo(
    () => new URLSearchParams(location.search).get("session"),
    [location.search],
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLargeScreen, setIsLargeScreen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [renameDialog, setRenameDialog] = useState<SessionDialogState | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<SessionDialogState | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const { isDrawerFullscreen } = useChatLayoutStore();
  const { openLogin } = useLoginDialog();
  const { theme, toggleTheme } = useThemeStore();

  const {
    sessions: chatSessions,
    notifications,
    isLoading: sessionsLoading,
    loadSessions: loadChatSessions,
    setActiveSessionId,
    removeSession: handleRemoveSession,
    renameSession: handleRenameSession,
    toggleSessionPinned,
    dismissSessionNotification,
    resetSessionStore,
    newSession: createNewSession,
  } = useSessionStore();

  const isFloating = !isSidebarOpen && isHovering && isLargeScreen;
  const isCoverRoute = location.pathname === "/";
  const isFullScreenRoute =
    isCoverRoute ||
    location.pathname === "/chat" ||
    location.pathname === "/collections" ||
    location.pathname === "/profile" ||
    location.pathname.startsWith("/reports/") ||
    location.pathname === "/trend-flow" ||
    location.pathname.startsWith("/trend-flow/");
  const isChatImmersive = location.pathname === "/chat" && isDrawerFullscreen;

  const hasRunningSession = chatSessions.some(
    (session) =>
      session.execution_status === "running" ||
      session.execution_status === "stopping",
  );
  const hasStoppingSession = chatSessions.some(
    (session) => session.execution_status === "stopping",
  );
  const { planBadgeLabel } = useMembershipStatus();

  useEffect(() => {
    if (notifications.length === 0) return;

    const timers = notifications.map((item) =>
      window.setTimeout(() => {
        dismissSessionNotification(item.id);
      }, 5000),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismissSessionNotification, notifications]);

  const navigation = useMemo(
    () => [
      { to: "/chat", label: t("common:aiAssistant"), icon: MessageCircle },
      { to: "/reports", label: t("reports:title"), icon: LayoutDashboard },
      { to: "/trend-flow", label: t("trend-flow:title"), icon: Sparkles },
      { to: "/inspiration", label: t("common:inspiration"), icon: Sparkles },
      { to: "/collections", label: t("common:favoritesTab"), icon: Heart },
    ],
    [t],
  );

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const checkScreenSize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const isLarge = shouldPinAppShellSidebar(
          window.innerWidth,
          window.innerHeight,
        );
        setIsLargeScreen((prev) => {
          if (prev !== isLarge) {
            setIsSidebarOpen(isLarge);
          }
          return isLarge;
        });
      }, 100);
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => {
      window.removeEventListener("resize", checkScreenSize);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      resetSessionStore();
    }
  }, [currentUserId, resetSessionStore]);

  useEffect(() => {
    if (!currentUserId) return;
    loadChatSessions();

    const interval = window.setInterval(
      () => {
        loadChatSessions();
      },
      hasRunningSession ? 4000 : 15000,
    );

    return () => window.clearInterval(interval);
  }, [currentUserId, hasRunningSession, loadChatSessions]);

  useEffect(() => {
    if (!currentUserId) return;

    const interval = window.setInterval(() => {
      void getCurrentUser().catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [currentUserId]);

  const toggleLanguage = useCallback(() => {
    const next = i18n.language === "zh-CN" ? "en" : "zh-CN";
    i18n.changeLanguage(next);
  }, [i18n]);

  const sidebarWidth =
    isLargeScreen && isSidebarOpen && !isChatImmersive ? SIDEBAR_WIDTH : 0;
  const currentLanguageLabel = i18n.language === "zh-CN" ? "中文" : "EN";
  const currentThemeLabel =
    theme === "dark" ? t("common:themeDark") : t("common:themeLight");

  const closeSidebarChrome = useCallback(() => {
    if (isFloating) setIsHovering(false);
    if (!isLargeScreen) setIsSidebarOpen(false);
  }, [isFloating, isLargeScreen]);

  const handleProtectedNavigate = useCallback(
    (to: string) => {
      if (!currentUser) {
        navigate("/", { replace: location.pathname !== "/" });
        openLogin();
        closeSidebarChrome();
        return;
      }
      navigate(to);
      closeSidebarChrome();
    },
    [closeSidebarChrome, currentUser, location.pathname, navigate, openLogin],
  );

  const handleCreateSession = useCallback(async () => {
    if (!currentUser) {
      navigate("/", { replace: location.pathname !== "/" });
      openLogin();
      closeSidebarChrome();
      return;
    }

    setActiveSessionId(null);
    navigate("/chat", { replace: location.pathname === "/chat" });

    const newSession = await createNewSession();
    closeSidebarChrome();
    if (newSession) {
      navigate(`/chat?session=${newSession.id}`);
    } else {
      navigate("/chat");
    }
  }, [
    closeSidebarChrome,
    createNewSession,
    currentUser,
    location.pathname,
    navigate,
    openLogin,
    setActiveSessionId,
  ]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteDialog) return;

    setIsDeleting(true);
    const result = await handleRemoveSession(deleteDialog.sessionId);
    const deletingCurrentRoute =
      location.pathname === "/chat" &&
      currentRouteSessionId === deleteDialog.sessionId;
    setIsDeleting(false);
    setDeleteDialog(null);

    if (!result || !deletingCurrentRoute) return;

    if (result.nextActiveSessionId) {
      navigate(`/chat?session=${result.nextActiveSessionId}`, {
        replace: true,
      });
    } else {
      navigate("/chat", { replace: true });
    }
  }, [
    currentRouteSessionId,
    deleteDialog,
    handleRemoveSession,
    location.pathname,
    navigate,
  ]);

  const handleRenameConfirmed = useCallback(async () => {
    if (!renameDialog) return;
    const title = renameValue.trim();
    if (!title) return;

    setIsRenaming(true);
    const updated = await handleRenameSession(renameDialog.sessionId, title);
    setIsRenaming(false);
    if (!updated) return;

    setRenameDialog(null);
    setRenameValue("");
  }, [handleRenameSession, renameDialog, renameValue]);

  const sidebarContent = (
    <>
      <div className="shrink-0 border-b border-border/70 px-3 py-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            className="flex items-center transition-opacity duration-fast hover:opacity-70"
            to="/"
          >
            <img
              src="/aimoda-logo.svg"
              alt="aimoda"
              className="dark:hidden h-[22px]"
            />
            <img
              src="/aimoda-logo-inverted.svg"
              alt="aimoda"
              className="hidden dark:block h-[22px]"
            />
          </Link>

          <div className="flex items-center gap-1">
            {!isFloating && isLargeScreen && (
              <button
                onClick={() => setIsSidebarOpen(false)}
                className={SIDEBAR_ICON_BUTTON_CLASS}
              >
                <PanelLeftClose size={15} />
              </button>
            )}

            {isFloating && (
              <button
                onClick={() => setIsHovering(false)}
                className={SIDEBAR_ICON_BUTTON_CLASS}
                title={t("common:close")}
              >
                <PanelLeftClose size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2.5 px-3">
        <Button
          className="type-chat-action w-full cursor-pointer justify-center"
          onClick={handleCreateSession}
        >
          <span>{t("common:fashionSearch")}</span>
        </Button>
      </div>

      <nav className="mt-5 space-y-1 px-3">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "type-chat-label group flex items-center justify-between gap-2.5 rounded-none border px-3 py-2.5",
                  "transition-[background-color,border-color,color,transform] duration-fast cursor-pointer",
                  isActive
                    ? "border-border bg-card/90 text-foreground shadow-token-sm"
                    : "border-transparent text-muted-foreground hover:-translate-y-px hover:border-border/70 hover:bg-card/65 hover:text-foreground",
                ].join(" ")
              }
              onClick={(event) => {
                event.preventDefault();
                handleProtectedNavigate(item.to);
              }}
            >
              <div className="flex items-center gap-2.5">
                <Icon className="size-4 shrink-0" />
                <div className="flex flex-col gap-1">
                  <span>{item.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ChevronRight className="size-3.5 shrink-0 opacity-55" />
              </div>
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-5 px-3">
        <Separator />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
        <button
          className="type-chat-kicker flex w-full items-center gap-2 px-1 text-muted-foreground cursor-pointer"
          onClick={() => setHistoryExpanded((value) => !value)}
        >
          {historyExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
          <History size={15} />
          <span>{t("common:chatHistory")}</span>
          {hasRunningSession && (
            <Badge variant="warning" size="sm" className="ml-auto">
              <LoaderCircle className="size-3 animate-spin" />
              {hasStoppingSession ? t("common:stopping") : t("common:running")}
            </Badge>
          )}
        </button>

        {historyExpanded && (
          <div className="mt-3.5 space-y-1.5">
            {sessionsLoading ? (
              <div className="type-chat-meta border border-border/60 bg-background px-3 py-3 text-center text-muted-foreground">
                {t("common:loading")}
              </div>
            ) : chatSessions.length === 0 ? (
              <div className="type-chat-meta border border-border/60 bg-background px-3 py-3 text-center text-muted-foreground">
                {t("common:noChatHistory")}
              </div>
            ) : (
              chatSessions.map((session) => {
                const isActive =
                  location.pathname === "/chat" &&
                  currentRouteSessionId === session.id;
                const metaTimestamp = formatSidebarSessionTimestamp(
                  session.updated_at,
                  i18n.language,
                );

                return (
                  <div
                    key={session.id}
                    className={cn(
                      "group rounded-none border border-border/55 bg-background px-2.5 py-2.5 shadow-token-sm transition-[background-color,border-color,color,transform] cursor-pointer",
                      isActive
                        ? "border-foreground/12 bg-card text-foreground shadow-token-md"
                        : "text-muted-foreground hover:-translate-y-px hover:border-border hover:bg-card/72 hover:text-foreground",
                    )}
                    onClick={() =>
                      handleProtectedNavigate(`/chat?session=${session.id}`)
                    }
                  >
                    <div className="flex items-start gap-2">
                      <MessageCircle className="mt-[3px] size-3.5 shrink-0 opacity-40" />

                      <div className="min-w-0 flex-1">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="type-chat-label truncate text-foreground/92">
                                {session.title}
                              </span>
                              {session.is_pinned && (
                                <Pin className="size-3.5 shrink-0 text-foreground/65" />
                              )}
                            </div>

                            <div className="type-chat-meta mt-1 flex min-w-0 items-center gap-2 whitespace-nowrap text-muted-foreground/88">
                              {(session.execution_status === "running" ||
                                session.execution_status === "stopping") && (
                                <span className="inline-flex items-center gap-1 text-foreground/78">
                                  <LoaderCircle className="size-3 animate-spin" />
                                  <span>
                                    {session.execution_status === "stopping"
                                      ? t("common:stopping")
                                      : t("common:running")}
                                  </span>
                                </span>
                              )}
                              {session.execution_status === "error" && (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <AlertTriangle className="size-3" />
                                  <span>{t("common:failed")}</span>
                                </span>
                              )}
                              <span className="truncate">{metaTimestamp}</span>
                            </div>
                          </div>

                          <div
                            className={cn(
                              "flex items-center justify-end gap-1 transition-[opacity,transform] duration-fast md:w-[72px]",
                              isActive
                                ? "opacity-100"
                                : "opacity-0 translate-x-1 pointer-events-none md:group-hover:pointer-events-auto md:group-hover:translate-x-0 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:translate-x-0 md:group-focus-within:opacity-100",
                            )}
                          >
                            <button
                              className={SIDEBAR_SESSION_ACTION_CLASS}
                              onClick={async (event) => {
                                event.stopPropagation();
                                await toggleSessionPinned(
                                  session.id,
                                  !session.is_pinned,
                                );
                              }}
                              aria-label={
                                session.is_pinned
                                  ? t("common:unpin")
                                  : t("common:pin")
                              }
                              title={
                                session.is_pinned
                                  ? t("common:unpin")
                                  : t("common:pin")
                              }
                            >
                              {session.is_pinned ? (
                                <PinOff size={13} />
                              ) : (
                                <Pin size={13} />
                              )}
                            </button>
                            <button
                              className={SIDEBAR_SESSION_ACTION_CLASS}
                              onClick={(event) => {
                                event.stopPropagation();
                                setRenameDialog({
                                  sessionId: session.id,
                                  title: session.title,
                                });
                                setRenameValue(session.title);
                              }}
                              aria-label={t("common:rename")}
                              title={t("common:rename")}
                            >
                              <PencilLine size={13} />
                            </button>
                            <button
                              className={cn(
                                SIDEBAR_SESSION_ACTION_CLASS,
                                "hover:border-foreground hover:bg-foreground hover:text-background",
                              )}
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteDialog({
                                  sessionId: session.id,
                                  title: session.title,
                                });
                              }}
                              aria-label={t("common:delete")}
                              title={t("common:delete")}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="mt-auto shrink-0">
        <div className="px-3">
          <Separator />
        </div>

        <div className="px-3 py-3">
          <div className="mb-2.5 grid grid-cols-2 gap-2">
            <button
              onClick={toggleTheme}
              className={cn(SIDEBAR_UTILITY_BUTTON_CLASS, "justify-center")}
              title={
                theme === "dark"
                  ? t("common:switchLight")
                  : t("common:switchDark")
              }
            >
              <span className="flex items-center gap-2">
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                <span>{currentThemeLabel}</span>
              </span>
            </button>

            <button
              onClick={toggleLanguage}
              className={cn(SIDEBAR_UTILITY_BUTTON_CLASS, "justify-center")}
              title={
                i18n.language === "zh-CN"
                  ? t("common:switchToEn")
                  : t("common:switchToZh")
              }
            >
              <span className="flex items-center gap-2">
                <Globe size={14} />
                <span>{currentLanguageLabel}</span>
              </span>
            </button>
          </div>

          {currentUser ? (
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                [
                  "mt-2.5 flex items-center gap-2.5 rounded-none border border-border/70 bg-background px-3 py-2.5 shadow-token-sm transition-[background-color,border-color,transform] cursor-pointer",
                  isActive
                    ? "border-foreground/20 bg-card shadow-token-md"
                    : "hover:-translate-y-px hover:border-foreground/18 hover:bg-card/80",
                ].join(" ")
              }
              onClick={() => {
                if (isFloating) setIsHovering(false);
                if (!isLargeScreen) setIsSidebarOpen(false);
              }}
            >
              <CircleUserRound className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="type-chat-label truncate text-foreground">
                    {currentUser.name ?? t("common:user")}
                  </p>
                  <span className="type-chat-kicker shrink-0 border border-border/70 bg-background px-2 py-1 text-muted-foreground">
                    {planBadgeLabel}
                  </span>
                </div>
                <p className="type-chat-meta text-muted-foreground">
                  {currentUser.role ?? "guest"}
                </p>
              </div>
            </NavLink>
          ) : (
            <Button
              onClick={openLogin}
              className="type-chat-action flex w-full cursor-pointer items-center justify-between px-4"
            >
              <div className="flex items-center gap-1.5">
                <CircleUserRound className="size-4" />
                <span>{t("common:login")}</span>
              </div>
              <span className="type-caption opacity-70">
                {t("common:startJourney")}
              </span>
            </Button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-background">
      <LoginDialog />

      <Dialog
        open={Boolean(renameDialog)}
        onOpenChange={(open) => !open && setRenameDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common:renameSession")}</DialogTitle>
            <DialogDescription>
              {t("common:renameSessionHint")}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder={t("common:sessionName")}
            maxLength={80}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && renameValue.trim()) {
                void handleRenameConfirmed();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              loading={isRenaming}
              onClick={() => void handleRenameConfirmed()}
              disabled={!renameValue.trim()}
            >
              {t("common:save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteDialog)}
        onOpenChange={(open) => !open && setDeleteDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common:confirmDeleteSession")}</DialogTitle>
            <DialogDescription>
              {deleteDialog
                ? t("common:confirmDeleteSessionHint", {
                    title: deleteDialog.title,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              loading={isDeleting}
              onClick={() => void handleDeleteConfirmed()}
            >
              {t("common:delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {notifications.length > 0 && (
        <div className="fixed right-4 top-4 z-toast flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
          {notifications.slice(0, 4).map((item) => {
            const Icon = item.kind === "completed" ? CheckCircle2 : BellRing;
            const iconClassName =
              item.kind === "completed"
                ? "text-foreground"
                : "text-muted-foreground";

            return (
              <div
                key={item.id}
                className="w-full border border-border bg-background p-4 text-left shadow-lg"
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={cn("mt-0.5 size-5 shrink-0", iconClassName)}
                  />
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      dismissSessionNotification(item.id);
                      handleProtectedNavigate(
                        `/chat?session=${item.sessionId}`,
                      );
                    }}
                  >
                    <div className="type-ui-title-sm text-foreground">
                      {item.title}
                    </div>
                    <div className="type-ui-body-sm mt-1 text-muted-foreground">
                      {item.message}
                    </div>
                  </button>
                  <button
                    className="border border-transparent p-1 text-muted-foreground opacity-70 transition-all hover:border-border hover:bg-accent hover:opacity-100"
                    onClick={() => {
                      dismissSessionNotification(item.id);
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isSidebarOpen && !isLargeScreen && !isChatImmersive && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-normal"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {!isSidebarOpen && isLargeScreen && !isChatImmersive && (
        <div
          className="fixed top-2 left-0 w-4 z-50"
          style={{ height: "calc(100% - 56px)" }}
          onMouseEnter={() => setIsHovering(true)}
        />
      )}

      {isFloating && !isChatImmersive && (
        <>
          <div
            className="fixed top-2 left-2 z-50 flex flex-col overflow-hidden border border-border/60 bg-sidebar shadow-token-xl"
            style={{
              width: `${SIDEBAR_WIDTH}px`,
              maxHeight: "calc(100dvh - 16px)",
            }}
          >
            <div className="overflow-y-auto flex flex-col h-full">
              {sidebarContent}
            </div>
          </div>
          <div
            className="fixed inset-0 z-40"
            onMouseEnter={() => setIsHovering(false)}
            onClick={() => setIsHovering(false)}
          />
        </>
      )}

      {!isFloating && !isChatImmersive && (
        <aside
          className="fixed left-0 top-0 z-50 flex h-dvh flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-normal ease-out"
          style={{
            width: `${SIDEBAR_WIDTH}px`,
            transform: isSidebarOpen
              ? "translateX(0)"
              : `translateX(-${SIDEBAR_WIDTH}px)`,
            pointerEvents: isSidebarOpen ? "auto" : "none",
          }}
        >
          {sidebarContent}
        </aside>
      )}

      {!isLargeScreen && isSidebarOpen && !isChatImmersive && (
        <button
          onClick={() => setIsSidebarOpen(false)}
          className="fixed top-4 z-popover cursor-pointer"
          style={{ left: `min(calc(100vw - 3rem), ${SIDEBAR_WIDTH + 16}px)` }}
          aria-label={t("common:close")}
        >
          <X className="size-5 text-muted-foreground" />
        </button>
      )}

      <main
        className="min-h-dvh bg-transparent transition-all duration-normal ease-out"
        style={{
          marginLeft: isLargeScreen && !isCoverRoute ? `${sidebarWidth}px` : 0,
        }}
      >
        <header
          className={cn(
            "sticky top-0 z-30 flex h-14 items-center border-b border-border bg-background px-4",
            isLargeScreen && "hidden",
            isChatImmersive && "hidden",
          )}
        >
          <div className="w-10 flex justify-start">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="-ml-1 control-icon-sm flex items-center justify-center border border-transparent transition-colors cursor-pointer hover:border-border active:bg-accent"
              aria-label={t("common:openMenu")}
            >
              <Menu className="size-5 text-foreground" />
            </button>
          </div>

          <div className="flex-1 flex justify-center">
            <Link to="/">
              <img
                src="/aimoda-logo.svg"
                alt="aimoda"
                className="dark:hidden h-[18px]"
              />
              <img
                src="/aimoda-logo-inverted.svg"
                alt="aimoda"
                className="hidden dark:block h-[18px]"
              />
            </Link>
          </div>

          <div className="w-10 flex justify-end items-center gap-0.5">
            <button
              onClick={toggleTheme}
              className="control-icon-sm flex items-center justify-center border border-transparent cursor-pointer text-muted-foreground transition-colors hover:border-border hover:text-foreground active:bg-accent"
              aria-label={
                theme === "dark"
                  ? t("common:switchLight")
                  : t("common:switchDark")
              }
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={toggleLanguage}
              className="-mr-1 control-icon-sm flex items-center justify-center border border-transparent cursor-pointer text-muted-foreground transition-colors hover:border-border hover:text-foreground active:bg-accent"
              aria-label={
                i18n.language === "zh-CN"
                  ? t("common:switchToEn")
                  : t("common:switchToZh")
              }
            >
              <Globe size={16} />
            </button>
          </div>
        </header>

        {isLargeScreen && !isSidebarOpen && !isChatImmersive && (
          <div className="fixed top-3 left-3 z-30">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSidebarOpen(true)}
              className="control-icon-sm cursor-pointer border border-border bg-background p-0"
            >
              <Menu className="size-4 text-muted-foreground" />
            </Button>
          </div>
        )}

        {isFullScreenRoute ? (
          <div className={cn("h-[calc(100dvh-56px)]", isLargeScreen && "h-dvh")}>
            <Outlet />
          </div>
        ) : (
          <PageFrame>
            <Outlet />
          </PageFrame>
        )}
      </main>
    </div>
  );
}
