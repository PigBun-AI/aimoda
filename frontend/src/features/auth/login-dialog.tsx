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
const AUTH_INPUT_CLASS = 'type-chat-body min-h-10 rounded-none border border-border/80 bg-background px-3.5 py-2.5 leading-[1.45]'

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
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[min(880px,calc(100%-1rem))] max-w-[880px] overflow-y-auto border border-border/80 bg-background p-0 shadow-[var(--shadow-xl)] sm:w-[min(880px,calc(100%-1.5rem))]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('common:loginRegister')}</DialogTitle>
          <DialogDescription>{t('auth:loginToView')}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 xl:min-h-[520px] xl:grid-cols-[minmax(280px,0.84fr)_minmax(340px,1fr)]">
          <aside className="flex flex-col justify-between border-b border-border/80 bg-background px-5 py-5 xl:border-b-0 xl:border-r xl:px-6 xl:py-6">
            <div className="space-y-6">
              <div className="space-y-3.5 border-b border-border/80 pb-5">
                <p className="type-chat-kicker text-muted-foreground">
                  aimoda
                </p>
                <div className="space-y-4">
                  <img src="/aimoda-logo.svg" alt="aimoda" className="h-7 dark:hidden" />
                  <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden h-7 dark:block" />
                  <h2 className="type-page-title max-w-[12ch] text-foreground">
                    {mode === 'sms' ? t('common:smsLogin') : t('common:emailLogin')}
                  </h2>
                  <p className="type-body-muted max-w-[28ch] text-muted-foreground">
                    {mode === 'sms' ? t('auth:loginToView') : t('auth:welcomeBack')}
                  </p>
                </div>
              </div>

              <div className="grid gap-0 border border-border/80">
                {productLines.map((item, index) => (
                  <div
                    key={item}
                    className={cn(
                      'type-chat-kicker flex items-center justify-between px-3 py-3 text-muted-foreground',
                      index < productLines.length - 1 && 'border-b border-border/80',
                    )}
                  >
                    <span>{item}</span>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3.5 border-t border-border/80 pt-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2 sm:pr-3">
                  <p className="type-chat-kicker text-muted-foreground">
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

          <section className="flex flex-col justify-between px-5 py-5 xl:px-6 xl:py-6">
            <div className="space-y-5 xl:max-w-[27rem] xl:pr-4">
              <div className="space-y-4 border-b border-border/80 pb-4">
                <p className="type-chat-kicker text-muted-foreground">
                  {t('auth:authMethods')}
                </p>

                <div className="grid grid-cols-2 gap-2 border border-border/80 p-1">
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
                          'type-chat-action min-h-10 border px-3.5 transition-colors',
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
                <div className="type-body-sm border border-border/80 bg-muted/[0.08] px-3.5 py-2.5 text-foreground">
                  {error}
                </div>
              )}

              {mode === 'sms' ? (
                <form onSubmit={handleSmsLogin} className="space-y-5">
                  <div className="space-y-2.5">
                    <label className="type-chat-kicker block text-muted-foreground">
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
                    <label className="type-chat-kicker block text-muted-foreground">
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
                        className="type-chat-action h-12 rounded-none border-border/80"
                      >
                        {isSendingCode ? t('common:sending') : renderResendLabel()}
                      </Button>
                    </div>
                  </div>

                  <Button type="submit" className="type-chat-action h-12 w-full rounded-none" loading={isLoading}>
                    {t('common:login')}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleAdminLogin} className="space-y-5">
                  <div className="space-y-2.5">
                    <label className="type-chat-kicker block text-muted-foreground">
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
                    <label className="type-chat-kicker block text-muted-foreground">
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

                  <Button type="submit" className="type-chat-action h-12 w-full rounded-none" loading={isLoading}>
                    {t('common:login')}
                  </Button>
                </form>
              )}
            </div>

            <div className="type-caption mt-8 border-t border-border/80 pt-4 text-muted-foreground">
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
