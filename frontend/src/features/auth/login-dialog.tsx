import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { WechatQrCode } from '@/components/support/wechat-qr-code'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getApiErrorMessage, login, loginWithSms, sendSmsCode } from '@/lib/api'
import type { AuthUser } from '@/lib/types'
import { useLoginDialog } from './auth-store'
import { queryClient } from '@/main'
import { saveSession } from './protected-route'

const COUNTDOWN_SECONDS = 60
const AUTH_INPUT_CLASS = 'h-12 rounded-none border border-border bg-background px-4 text-sm leading-[1.45]'

export function LoginDialog() {
  const { t } = useTranslation(['auth', 'common'])
  const { isLoginOpen, closeLogin } = useLoginDialog()

  const [mode, setMode] = useState<'sms' | 'admin'>('sms')
  const [smsPhone, setSmsPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const productLines = useMemo(
    () => [t('auth:productLineReports'), t('auth:productLineAssistant'), t('auth:productLineInspiration')],
    [t],
  )

  useEffect(() => {
    if (countdown <= 0) {
      return
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => Math.max(prev - 1, 0))
    }, 1000)

    return () => clearTimeout(timer)
  }, [countdown])

  const resetState = useCallback(() => {
    setMode('sms')
    setSmsPhone('')
    setSmsCode('')
    setEmail('')
    setPassword('')
    setCountdown(0)
    setError(null)
    setIsLoading(false)
    setIsSendingCode(false)
  }, [])

  const handleSuccess = useCallback(
    (user: AuthUser) => {
      queryClient.removeQueries()
      saveSession(JSON.stringify(user))
      resetState()
      closeLogin()
      window.location.reload()
    },
    [closeLogin, resetState],
  )

  const handleClose = useCallback(() => {
    closeLogin()
    resetState()
  }, [closeLogin, resetState])

  const handleSendCode = useCallback(async () => {
    if (smsPhone.trim().length === 0) {
      setError(t('common:fillAccount'))
      return
    }

    setError(null)
    setIsSendingCode(true)

    try {
      await sendSmsCode({ phone: smsPhone, purpose: 'login' })
      setCountdown(COUNTDOWN_SECONDS)
    } catch (sendError) {
      setError(getApiErrorMessage(sendError, t('auth:loginFailed')))
    } finally {
      setIsSendingCode(false)
    }
  }, [smsPhone, t])

  const handleSmsLogin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setError(null)

      if (smsPhone.trim().length === 0) {
        setError(t('common:fillAccount'))
        return
      }

      if (smsCode.trim().length === 0) {
        setError(t('common:fillCode'))
        return
      }

      setIsLoading(true)

      try {
        const user = await loginWithSms({ phone: smsPhone, code: smsCode })
        handleSuccess(user)
      } catch (loginError) {
        setError(getApiErrorMessage(loginError, t('auth:loginFailed')))
      } finally {
        setIsLoading(false)
      }
    },
    [handleSuccess, smsCode, smsPhone, t],
  )

  const handleAdminLogin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setError(null)

      if (email.trim().length === 0) {
        setError(t('common:fillEmail'))
        return
      }

      if (password.length === 0) {
        setError(t('common:fillPassword'))
        return
      }

      setIsLoading(true)

      try {
        const user = await login({ email, password })
        handleSuccess(user)
      } catch (loginError) {
        setError(getApiErrorMessage(loginError, t('auth:invalidCredentials')))
      } finally {
        setIsLoading(false)
      }
    },
    [email, handleSuccess, password, t],
  )

  const renderResendLabel = () => {
    if (countdown <= 0) {
      return t('common:sendCode')
    }

    return t('common:resendCountdown', { n: countdown })
  }

  return (
    <Dialog open={isLoginOpen} onOpenChange={(open) => { if (open === false) handleClose() }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[min(920px,calc(100%-1rem))] max-w-[920px] overflow-y-auto border border-border bg-card p-0 shadow-[var(--shadow-xl)] sm:w-[min(920px,calc(100%-1.5rem))]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('common:loginRegister')}</DialogTitle>
          <DialogDescription>{t('auth:loginToView')}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 md:min-h-[560px] md:grid-cols-[minmax(300px,0.9fr)_minmax(360px,1fr)]">
          <aside className="flex flex-col justify-between border-b border-border bg-background px-6 py-6 md:border-b-0 md:border-r md:px-8 md:py-8">
            <div className="space-y-8">
              <div className="space-y-4 border-b border-border pb-6">
                <p className="type-kicker-wide text-muted-foreground">
                  aimoda
                </p>
                <div className="space-y-4">
                  <img src="/aimoda-logo.svg" alt="aimoda" className="h-7 dark:hidden" />
                  <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden h-7 dark:block" />
                  <h2 className="type-page-title max-w-[11ch] text-foreground sm:text-[2.7rem]">
                    {mode === 'sms' ? t('common:smsLogin') : t('common:emailLogin')}
                  </h2>
                  <p className="type-body-muted max-w-[30ch] text-muted-foreground">
                    {mode === 'sms' ? t('auth:loginToView') : t('auth:welcomeBack')}
                  </p>
                </div>
              </div>

              <div className="grid gap-0 border border-border">
                {productLines.map((item, index) => (
                  <div
                    key={item}
                    className={cn(
                      'type-kicker flex items-center justify-between px-4 py-4 text-muted-foreground',
                      index < productLines.length - 1 && 'border-b border-border',
                    )}
                  >
                    <span>{item}</span>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 border-t border-border pt-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2 sm:pr-3">
                  <p className="type-kicker text-muted-foreground">
                    {t('auth:serviceTitle')}
                  </p>
                  <p className="type-body-sm max-w-[24ch] text-muted-foreground">
                    {t('auth:serviceHint')}
                  </p>
                </div>
                <WechatQrCode size={88} />
              </div>
            </div>
          </aside>

          <section className="flex flex-col justify-between px-6 py-6 md:px-8 md:py-8">
            <div className="space-y-6 lg:pr-6">
              <div className="space-y-5 border-b border-border pb-5">
                <p className="type-kicker text-muted-foreground">
                  {t('auth:authMethods')}
                </p>

                <div className="grid grid-cols-2 gap-2 border border-border p-1">
                  {([
                    ['sms', t('common:smsLogin')],
                    ['admin', t('common:emailLogin')],
                  ] as const).map(([value, label]) => {
                    const active = mode === value
                    return (
                      <button
                        key={value}
                        type="button"
                        className={cn(
                          'type-action-label h-11 border px-4 transition-colors',
                          active
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
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
              </div>

              {error && (
                <div className="type-body-sm border border-foreground/20 bg-foreground/[0.03] px-4 py-3 text-foreground dark:bg-foreground/[0.06]">
                  {error}
                </div>
              )}

              {mode === 'sms' ? (
                <form onSubmit={handleSmsLogin} className="space-y-5">
                  <div className="space-y-2.5">
                    <label className="type-kicker block text-muted-foreground">
                      {t('auth:mobileLabel')}
                    </label>
                    <Input
                      value={smsPhone}
                      onChange={(event) => setSmsPhone(event.target.value)}
                      placeholder={t('common:enterPhone')}
                      autoComplete="tel"
                      className={AUTH_INPUT_CLASS}
                      required
                    />
                  </div>

                  <div className="space-y-2.5">
                    <label className="type-kicker block text-muted-foreground">
                      {t('auth:codeLabel')}
                    </label>
                    <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_176px]">
                      <Input
                        value={smsCode}
                        onChange={(event) => setSmsCode(event.target.value)}
                        placeholder={t('common:enterCode')}
                        autoComplete="one-time-code"
                        className={AUTH_INPUT_CLASS}
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSendCode}
                        disabled={isSendingCode || countdown > 0 || isLoading}
                        className="h-12 rounded-none"
                      >
                        {isSendingCode ? t('common:sending') : renderResendLabel()}
                      </Button>
                    </div>
                  </div>

                  <Button type="submit" className="h-12 w-full rounded-none" loading={isLoading}>
                    {t('common:login')}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleAdminLogin} className="space-y-5">
                  <div className="space-y-2.5">
                    <label className="type-kicker block text-muted-foreground">
                      {t('auth:email')}
                    </label>
                    <Input
                      type="email"
                      placeholder={t('common:enterEmail')}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      className={AUTH_INPUT_CLASS}
                      required
                    />
                  </div>

                  <div className="space-y-2.5">
                    <label className="type-kicker block text-muted-foreground">
                      {t('auth:password')}
                    </label>
                    <Input
                      type="password"
                      placeholder={t('common:enterPassword')}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      className={AUTH_INPUT_CLASS}
                      required
                    />
                  </div>

                  <Button type="submit" className="h-12 w-full rounded-none" loading={isLoading}>
                    {t('common:login')}
                  </Button>
                </form>
              )}
            </div>

            <div className="type-caption mt-8 border-t border-border pt-4 text-muted-foreground">
              {t('common:agreeToTerms')}
              <span className="mx-2 text-foreground">{t('common:userAgreement')}</span>
              <span>/</span>
              <span className="mx-2 text-foreground">{t('common:privacyPolicy')}</span>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
