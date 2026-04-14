import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link, useLocation, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getApiErrorMessage, login, loginWithSms, sendSmsCode } from "@/lib/api"
import { cn } from "@/lib/utils"
import { queryClient } from "@/main"
import { AuthShell } from "./auth-shell"
import { saveSession } from "./protected-route"

type LoginPayload =
  | { mode: "sms"; phone: string; code: string }
  | { mode: "admin"; email: string; password: string }

const COUNTDOWN_SECONDS = 60
const AUTH_INPUT_CLASS = "min-h-10 rounded-none border-border/80 bg-background px-3.5 py-2.5 type-label placeholder:text-muted-foreground/80"

export function LoginPage() {
  const { t } = useTranslation(["auth", "common"])
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/reports"

  const [mode, setMode] = useState<"sms" | "admin">("sms")
  const [smsPhone, setSmsPhone] = useState("")
  const [smsCode, setSmsCode] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [countdown, setCountdown] = useState(0)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productLines = useMemo(
    () => [t("auth:productLineReports"), t("auth:productLineAssistant"), t("auth:productLineInspiration")],
    [t],
  )

  const mutation = useMutation({
    mutationFn: async (payload: LoginPayload) => {
      if (payload.mode === "sms") {
        return loginWithSms({ phone: payload.phone, code: payload.code })
      }
      return login({ email: payload.email, password: payload.password })
    },
    onSuccess: (user) => {
      queryClient.removeQueries()
      saveSession(JSON.stringify(user))
      setError(null)
      navigate(redirectTo, { replace: true })
    },
    onError: (mutationError, variables) => {
      const fallback = variables?.mode === "admin" ? t("auth:invalidCredentials") : t("auth:loginFailed")
      setError(getApiErrorMessage(mutationError, fallback))
    },
  })

  useEffect(() => {
    if (countdown <= 0) {
      return
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => Math.max(prev - 1, 0))
    }, 1000)

    return () => clearTimeout(timer)
  }, [countdown])

  const handleSendCode = useCallback(async () => {
    if (smsPhone.trim().length === 0) {
      setError(t("common:fillAccount"))
      return
    }

    setError(null)
    setIsSendingCode(true)

    try {
      await sendSmsCode({ phone: smsPhone, purpose: "login" })
      setCountdown(COUNTDOWN_SECONDS)
    } catch (sendError) {
      setError(getApiErrorMessage(sendError, t("auth:loginFailed")))
    } finally {
      setIsSendingCode(false)
    }
  }, [smsPhone, t])

  const renderResendLabel = () => {
    if (countdown <= 0) {
      return t("common:sendCode")
    }

    return t("common:resendCountdown", { n: countdown })
  }

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setError(null)

      if (mode === "sms") {
        if (smsPhone.trim().length === 0) {
          setError(t("common:fillAccount"))
          return
        }

        if (smsCode.trim().length === 0) {
          setError(t("common:fillCode"))
          return
        }

        mutation.mutate({ mode: "sms", phone: smsPhone, code: smsCode })
        return
      }

      if (email.trim().length === 0) {
        setError(t("common:fillEmail"))
        return
      }

      if (password.length === 0) {
        setError(t("common:fillPassword"))
        return
      }

      mutation.mutate({ mode: "admin", email, password })
    },
    [mode, smsPhone, smsCode, email, password, mutation, t],
  )

  return (
    <AuthShell
      title={t("auth:welcomeBack")}
      description={t("auth:loginToView")}
      productLines={productLines}
      heroFooter={t("auth:accessHint")}
      formEyebrow={t("auth:authMethods")}
      formHeader={(
        <div className="grid grid-cols-2 gap-2 border border-border/70 p-1">
          {([
            ["sms", t("common:smsLogin")],
            ["admin", t("common:emailLogin")],
          ] as const).map(([value, label]) => {
            const active = mode === value
            return (
              <button
                key={value}
                type="button"
                className={cn(
                  "type-chat-action min-h-10 border px-3.5 transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-transparent text-muted-foreground hover:border-border/70 hover:text-foreground",
                )}
                onClick={() => {
                  setMode(value)
                  setError(null)
                }}
                disabled={active}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
      formFooter={(
        <>
          <p>
            {t("common:agreeToTerms")} <span className="text-foreground">{t("common:userAgreement")}</span> /{" "}
            <span className="text-foreground">{t("common:privacyPolicy")}</span>
          </p>
          <p>
            {t("auth:noAccount")} <Link to="/register" className="text-foreground underline underline-offset-4">{t("auth:register")}</Link>
          </p>
        </>
      )}
    >
      {error ? (
        <div className="border border-foreground/20 bg-foreground/[0.03] px-3.5 py-2.5 dark:bg-foreground/[0.06]">
          <p className="type-ui-body-sm text-foreground">{error}</p>
        </div>
      ) : null}

      <form className="space-y-5" onSubmit={handleSubmit}>
        {mode === "sms" ? (
          <div className="space-y-5">
            <label className="grid gap-2.5">
              <span className="type-chat-kicker text-muted-foreground">{t("auth:mobileLabel")}</span>
              <Input
                value={smsPhone}
                onChange={(event) => setSmsPhone(event.target.value)}
                placeholder={t("common:enterPhone")}
                autoComplete="tel"
                className={AUTH_INPUT_CLASS}
              />
            </label>

            <label className="grid gap-2.5">
              <span className="type-chat-kicker text-muted-foreground">{t("auth:codeLabel")}</span>
              <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
                <Input
                  value={smsCode}
                  onChange={(event) => setSmsCode(event.target.value)}
                  placeholder={t("common:enterCode")}
                  autoComplete="one-time-code"
                  className={AUTH_INPUT_CLASS}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={isSendingCode || countdown > 0 || mutation.isPending}
                  className="rounded-none"
                >
                  {isSendingCode ? t("common:sending") : renderResendLabel()}
                </Button>
              </div>
            </label>
          </div>
        ) : (
          <div className="space-y-5">
            <label className="grid gap-2.5">
              <span className="type-chat-kicker text-muted-foreground">{t("auth:email")}</span>
              <Input
                type="email"
                placeholder={t("common:enterEmail")}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                className={AUTH_INPUT_CLASS}
              />
            </label>

            <label className="grid gap-2.5">
              <span className="type-chat-kicker text-muted-foreground">{t("auth:password")}</span>
              <Input
                type="password"
                placeholder={t("common:enterPassword")}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className={AUTH_INPUT_CLASS}
              />
            </label>
          </div>
        )}

        <Button type="submit" className="w-full rounded-none" loading={mutation.isPending}>
          {t("common:login")}
        </Button>
      </form>
    </AuthShell>
  )
}
