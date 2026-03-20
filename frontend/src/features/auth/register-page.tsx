import { FormEvent, useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { register } from '@/lib/api'
import { queryClient } from '@/main'

import { saveSession } from './protected-route'

export function RegisterPage() {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationError, setValidationError] = useState('')

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/reports'

  const mutation = useMutation({
    mutationFn: register,
    onSuccess: (user) => {
      queryClient.removeQueries()
      saveSession(JSON.stringify(user))
      navigate(redirectTo, { replace: true })
    },
  })

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setValidationError('')

    if (password !== confirmPassword) {
      setValidationError(t('passwordMismatch'))
      return
    }

    if (password.length < 8) {
      setValidationError(t('passwordTooShort'))
      return
    }

    mutation.mutate({ email, password })
  }, [password, confirmPassword, email, mutation, t])

  return (
    <div className="min-h-dvh flex bg-background">
      {/* Left side - Brand */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 border-r bg-secondary border-border"
      >
        <div className="max-w-md">
          <div className="mb-8">
            <p
              className="text-xs tracking-[0.3em] uppercase mb-3 text-muted-foreground"
            >
              World Wear Watch Daily
            </p>
            <h1 className="mb-4">
              <img src="/WWWD_logo_clean.svg" alt="WWWD" className="dark:hidden" style={{ height: 'clamp(56px, 7vw, 80px)' }} />
              <img src="/WWWD_logo_inverted.svg" alt="WWWD" className="hidden dark:block" style={{ height: 'clamp(56px, 7vw, 80px)' }} />
            </h1>
            <div
              className="w-12 h-px mb-6"
              style={{ backgroundColor: 'var(--border)' }}
            ></div>
            <p className="leading-relaxed text-muted-foreground">
              {tc('brandTagline')}
            </p>
          </div>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>· {tc('brandFeature1')}</p>
            <p>· {tc('brandFeature2')}</p>
            <p>· {tc('brandFeature3')}</p>
          </div>
        </div>
      </div>

      {/* Right side - Register Form */}
      <div
        className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-8 sm:py-10 bg-background"
      >
        <div className="w-full max-w-[340px] sm:max-w-sm">
          <div className="lg:hidden mb-10 text-center">
            <img src="/WWWD_logo_clean.svg" alt="WWWD" className="dark:hidden mx-auto h-12" />
            <img src="/WWWD_logo_inverted.svg" alt="WWWD" className="hidden dark:block mx-auto h-12" />
          </div>

          <div className="mb-8">
            <h2 className="text-2xl sm:text-3xl font-medium mb-2 text-foreground">
              {t('createAccount')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('registerHint')}
            </p>
          </div>

          <form className="space-y-4 sm:space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-sm text-muted-foreground"
              >
                {t('email')}
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-11 sm:h-12 bg-secondary border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-sm text-muted-foreground"
              >
                {t('password')}
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="h-11 sm:h-12 bg-secondary border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="confirmPassword"
                className="text-sm text-muted-foreground"
              >
                {t('confirmPassword')}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                className="h-11 sm:h-12 bg-secondary border-border text-foreground"
              />
            </div>

            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}

            {mutation.isError && (
              <p className="text-sm text-destructive">{t('registerFailed')}，{t('emailExists')}。</p>
            )}

            <Button
              className="w-full h-12 bg-foreground text-background"
              loading={mutation.isPending}
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? t('registering') : t('register')}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('haveAccount')}{' '}
            <Link to="/login" className="underline text-foreground">
              {t('login')}
            </Link>
          </p>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} World Wear Watch Daily. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}
