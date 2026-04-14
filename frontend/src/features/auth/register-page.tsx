import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getApiErrorMessage, registerWithSms, sendSmsCode } from "@/lib/api"
import { queryClient } from "@/main"
import { AuthShell } from "./auth-shell"
import { saveSession } from "./protected-route"

const COUNTDOWN_SECONDS = 60
const AUTH_INPUT_CLASS = "min-h-10 rounded-none border-border/80 bg-background px-3.5 py-2.5 type-label placeholder:text-muted-foreground/80"

export function RegisterPage() {
  const { t } = useTranslation(["auth", "common"])
  const navigate = useNavigate()
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [countdown, setCountdown] = useState(0)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productLines = useMemo(
    () => [t("auth:productLineReports"), t("auth:productLineAssistant"), t("auth:productLineInspiration")],
    [t],
  )

  const mutation = useMutation({
    mutationFn: async () => registerWithSms({ phone, code }),
    onSuccess: (user) => {
      queryClient.removeQueries()
      saveSession(JSON.stringify(user))
      setError(null)
      navigate("/reports", { replace: true })
    },
    onError: (mutationError) => {
      setError(getApiErrorMessage(mutationError, t("auth:registerFailed")))
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
    if (phone.trim().length === 0) {
      setError(t("common:fillAccount"))
      return
    }

    setError(null)
    setIsSendingCode(true)

    try {
      await sendSmsCode({ phone, purpose: "register" })
      setCountdown(COUNTDOWN_SECONDS)
    } catch (sendError) {
      setError(getApiErrorMessage(sendError, t("auth:registerFailed")))
    } finally {
      setIsSendingCode(false)
    }
  }, [phone, t])

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

      if (phone.trim().length === 0) {
        setError(t("common:fillAccount"))
        return
      }

      if (code.trim().length === 0) {
        setError(t("common:fillCode"))
        return
      }

      mutation.mutate()
    },
    [phone, code, mutation, t],
  )

  return (
    <AuthShell
      title={t("auth:createAccount")}
      description={t("auth:registerHint")}
      productLines={productLines}
      heroFooter={t("auth:registerAccessHint")}
      formEyebrow={t("auth:registerMethods")}
      formDescription={t("auth:registerIntro")}
      formFooter={(
        <>
          <p>
            {t("common:agreeToTerms")} <span className="text-foreground">{t("common:userAgreement")}</span> /{" "}
            <span className="text-foreground">{t("common:privacyPolicy")}</span>
          </p>
          <p>
            {t("auth:haveAccount")} <Link to="/login" className="text-foreground underline underline-offset-4">{t("auth:login")}</Link>
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
        <label className="grid gap-2.5">
          <span className="type-chat-kicker text-muted-foreground">{t("auth:mobileLabel")}</span>
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={t("common:enterPhone")}
            autoComplete="tel"
            className={AUTH_INPUT_CLASS}
          />
        </label>

        <label className="grid gap-2.5">
          <span className="type-chat-kicker text-muted-foreground">{t("auth:codeLabel")}</span>
          <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
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

        <Button type="submit" className="w-full rounded-none" loading={mutation.isPending}>
          {mutation.isPending ? t("auth:registering") : t("auth:register")}
        </Button>
      </form>
    </AuthShell>
  )
}
