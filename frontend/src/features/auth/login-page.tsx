import { FormEvent, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login } from '@/lib/api'
import { queryClient } from '@/main'

import { saveSession } from './protected-route'

export function LoginPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/reports'

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.removeQueries()
      saveSession(JSON.stringify(user))
      navigate(redirectTo, { replace: true })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate({ email, password })
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--bg-primary)]">
      {/* Left side - Brand (Desktop) */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] flex-col justify-center px-8 xl:px-16 border-r border-[var(--border-color)] bg-[var(--bg-secondary)] relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-[var(--gold-muted)] opacity-50 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-[var(--gold-muted)] opacity-30 blur-3xl" />
        </div>

        <div className="max-w-lg relative z-10">
          <header className="mb-8">
            <p className="text-xs tracking-[0.3em] uppercase mb-3 text-[var(--text-muted)]">
              World Wear Watch Daily
            </p>
            <h1 className="mb-6">
              <img src="/WWWD_logo_clean.svg" alt="WWWD" className="dark:hidden" style={{ height: 'clamp(56px, 7vw, 80px)' }} />
              <img src="/WWWD_logo_inverted.svg" alt="WWWD" className="hidden dark:block" style={{ height: 'clamp(56px, 7vw, 80px)' }} />
            </h1>
            <div className="w-12 h-px mb-6 bg-[var(--gold)] opacity-40" />
            <p className="leading-relaxed text-[var(--text-secondary)] text-base xl:text-lg">
              时尚趋势洞察日报，汇聚全球时装周精华，助您把握市场脉搏，做出明智决策。
            </p>
          </header>

          <ul className="space-y-3 text-sm xl:text-base text-[var(--text-muted)]">
            {['实时趋势解读', '精细化买手指南', '全链路数据分析'].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="flex-1 flex items-center justify-center px-4 py-8 sm:px-6 lg:px-8 bg-[var(--bg-primary)]">
        <div className="w-full max-w-sm">
          {/* Mobile Logo */}
          <div className="lg:hidden mb-8 text-center">
            <img src="/WWWD_logo_clean.svg" alt="WWWD" className="dark:hidden mx-auto" style={{ height: '48px' }} />
            <img src="/WWWD_logo_inverted.svg" alt="WWWD" className="hidden dark:block mx-auto" style={{ height: '48px' }} />
          </div>

          {/* Form Header */}
          <header className="mb-6 sm:mb-8">
            <h2 className="text-xl sm:text-2xl font-medium mb-2 text-[var(--text-primary)]">
              {t('welcomeBack')}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              {t('loginToView')}
            </p>
          </header>

          {/* Login Form */}
          <form className="space-y-4 sm:space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-[var(--text-secondary)]">
                {t('email')}
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                className="h-11 sm:h-12 text-base"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-[var(--text-secondary)]">
                {t('password')}
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                className="h-11 sm:h-12 text-base"
              />
            </div>

            {/* Error Message */}
            {mutation.isError && (
              <div className="p-3 rounded-[var(--radius-sm)] bg-red-500/10 border border-red-500/20" role="alert">
                <p className="text-sm text-red-500">{t('loginFailed')}，{t('invalidCredentials')}。</p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              className="w-full h-11 sm:h-12 text-base"
              loading={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? t('loggingIn') : t('login')}
            </Button>
          </form>

          {/* Register Link */}
          <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
            {t('noAccount')}{' '}
            <Link to="/register" className="underline text-[var(--text-primary)] hover:text-[var(--gold)] transition-colors">
              {t('register')}
            </Link>
          </p>

          {/* Copyright */}
          <p className="mt-8 sm:mt-12 text-center text-xs text-[var(--text-muted)]">
            &copy; 2026 World Wear Watch Daily. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}