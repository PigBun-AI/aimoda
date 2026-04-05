import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getApiErrorMessage, registerWithSms, sendSmsCode } from '@/lib/api'
import { cn } from '@/lib/utils'
import { queryClient } from '@/main'
import { saveSession } from './protected-route'

const COUNTDOWN_SECONDS = 60
const AUTH_INPUT_CLASS = 'h-12 rounded-none border border-border bg-background px-4 text-[14px] tracking-[0.01em]'

export function RegisterPage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productLines = useMemo(
    () => [t('auth:productLineReports'), t('auth:productLineAssistant'), t('auth:productLineInspiration')],
    [t],
  )

  const mutation = useMutation({
    mutationFn: async () => registerWithSms({ phone, code }),
    onSuccess: (user) => {
      queryClient.removeQueries()
      saveSession(JSON.stringify(user))
      setError(null)
      navigate('/reports', { replace: true })
    },
    onError: (mutationError) => {
      setError(getApiErrorMessage(mutationError, t('auth:registerFailed')))
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
      setError(t('common:fillAccount'))
      return
    }

    setError(null)
    setIsSendingCode(true)

    try {
      await sendSmsCode({ phone, purpose: 'register' })
      setCountdown(COUNTDOWN_SECONDS)
    } catch (sendError) {
      setError(getApiErrorMessage(sendError, t('auth:registerFailed')))
    } finally {
      setIsSendingCode(false)
    }
  }, [phone, t])

  const renderResendLabel = () => {
    if (countdown <= 0) {
      return t('common:sendCode')
    }

    return t('common:resendCountdown', { n: countdown })
  }

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setError(null)

      if (phone.trim().length === 0) {
        setError(t('common:fillAccount'))
        return
      }

      if (code.trim().length === 0) {
        setError(t('common:fillCode'))
        return
      }

      mutation.mutate()
    },
    [phone, code, mutation, t],
  )

  return (
    <div className="min-h-dvh bg-background px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto grid min-h-[calc(100dvh-2.5rem)] w-full max-w-[1320px] border border-border bg-card lg:grid-cols-[minmax(320px,0.95fr)_minmax(420px,1fr)]">
        <aside className="flex flex-col justify-between border-b border-border bg-background px-6 py-6 md:px-8 md:py-8 lg:border-b-0 lg:border-r lg:px-10 lg:py-10">
          <div className="space-y-8">
            <div className="space-y-4 border-b border-border pb-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                aimoda
              </p>
              <img src="/aimoda-logo.svg" alt="aimoda" className="h-8 dark:hidden" />
              <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden h-8 dark:block" />
              <h1 className="max-w-[10ch] font-serif text-[2.5rem] font-medium leading-[0.9] tracking-[-0.05em] text-foreground sm:text-[3.4rem]">
                {t('auth:createAccount')}
              </h1>
              <p className="max-w-[34ch] text-[11px] leading-5 tracking-[0.06em] text-muted-foreground">
                {t('auth:registerHint')}
              </p>
            </div>

            <div className="grid gap-0 border border-border">
              {productLines.map((item, index) => (
                <div key={item} className={cn('flex items-center justify-between px-4 py-4 text-[11px] uppercase tracking-[0.14em] text-muted-foreground', index < productLines.length - 1 && 'border-b border-border')}>
                  <span>{item}</span>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-6 text-[11px] leading-5 tracking-[0.04em] text-muted-foreground">
            {t('auth:registerAccessHint')}
          </div>
        </aside>

        <section className="flex items-center px-6 py-6 md:px-8 md:py-8 lg:px-10 lg:py-10">
          <div className="w-full max-w-[520px] space-y-8">
            <div className="space-y-5 border-b border-border pb-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {t('auth:registerMethods')}
              </p>
              <p className="text-[11px] leading-5 tracking-[0.06em] text-muted-foreground">
                {t('auth:registerIntro')}
              </p>
            </div>

            {error && (
              <div className="border border-foreground/20 bg-foreground/[0.03] px-4 py-3 text-[12px] leading-5 tracking-[0.03em] text-foreground dark:bg-foreground/[0.06]">
                {error}
              </div>
            )}

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2.5">
                <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t('auth:mobileLabel')}
                </label>
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder={t('common:enterPhone')}
                  autoComplete="tel"
                  className={AUTH_INPUT_CLASS}
                />
              </div>

              <div className="space-y-2.5">
                <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t('auth:codeLabel')}
                </label>
                <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder={t('common:enterCode')}
                    autoComplete="one-time-code"
                    className={AUTH_INPUT_CLASS}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendCode}
                    disabled={isSendingCode || countdown > 0 || mutation.isPending}
                    className="h-12 rounded-none"
                  >
                    {isSendingCode ? t('common:sending') : renderResendLabel()}
                  </Button>
                </div>
              </div>

              <Button type="submit" className="h-12 w-full rounded-none" loading={mutation.isPending}>
                {mutation.isPending ? t('auth:registering') : t('auth:register')}
              </Button>
            </form>

            <div className="grid gap-4 border-t border-border pt-4 text-[10px] leading-5 tracking-[0.04em] text-muted-foreground">
              <p>
                {t('common:agreeToTerms')}
                <span className="mx-2 text-foreground">{t('common:userAgreement')}</span>
                <span>/</span>
                <span className="mx-2 text-foreground">{t('common:privacyPolicy')}</span>
              </p>
              <p>
                {t('auth:haveAccount')} <Link to="/login" className="text-foreground underline underline-offset-4">{t('auth:login')}</Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
