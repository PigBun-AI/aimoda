import { useState, useRef, useCallback } from 'react'
import { Shield, Mail, Lock } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLoginDialog } from './auth-store'
import { login } from '@/lib/api'
import { saveSession } from './protected-route'
import { queryClient } from '@/main'

const WECHAT_QR_URL = import.meta.env.VITE_WECHAT_QR_URL || 'https://u.wechat.com/MF5PYmxZDLIHeXt8bY78UYg?s=2'

export function LoginDialog() {
  const { t, i18n } = useTranslation(['auth', 'common'])
  const { isLoginOpen, closeLogin } = useLoginDialog()

  const [isLoading, setIsLoading] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Email + password fields (primary)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // SMS fields (collapsible fallback)
  const [showSmsLogin, setShowSmsLogin] = useState(false)
  const [smsAccount, setSmsAccount] = useState('')
  const [verificationCode, setVerificationCode] = useState('')

  const [autoLogin, setAutoLogin] = useState(true)
  const formRef = useRef<HTMLFormElement>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Countdown timer ──────────────────────────────────────────────────────
  const startCountdown = useCallback((seconds: number) => {
    setCountdown(seconds)
  }, [])

  const handleSendCode = useCallback(async () => {
    if (!smsAccount) {
      setError(t('common:fillAccount'))
      return
    }
    setIsSendingCode(true)
    setError(null)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setIsSendingCode(false)
    startCountdown(60)
  }, [smsAccount, t, startCountdown])

  // ── Countdown effect ─────────────────────────────────────────────────────
  // Manually managed: we track countdown via useCallback so closure is stable

  // ── Email + Password login (primary) ────────────────────────────────────
  const handleEmailLogin = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    if (!email) { setError(t('common:fillEmail')); return }
    if (!password) { setError(t('common:fillPassword')); return }

    setIsLoading(true)
    try {
      const user = await login({ email, password })
      saveSession(JSON.stringify(user))
      queryClient.removeQueries()
      closeLogin()
      window.location.reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Try to extract backend error message
      if (message.includes('401') || message.includes('invalid')) {
        setError(t('auth:invalidCredentials'))
      } else if (message.includes('404') || message.includes('not found')) {
        setError(t('auth:invalidCredentials'))
      } else {
        setError(t('auth:loginFailed'))
      }
    } finally {
      setIsLoading(false)
    }
  }, [email, password, t, closeLogin])

  // ── SMS login (fallback, placeholder) ───────────────────────────────────
  const handleSmsLogin = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    if (!smsAccount) { setError(t('common:fillAccount')); return }
    if (!verificationCode) { setError(t('common:fillCode')); return }
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 1500))
    setIsLoading(false)
    setError(t('common:backendNotReady'))
  }, [smsAccount, verificationCode, t])

  const handleClose = () => {
    closeLogin()
    setError(null)
    setEmail('')
    setPassword('')
    setSmsAccount('')
    setVerificationCode('')
    setShowSmsLogin(false)
    setCountdown(0)
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    formRef.current?.reset()
  }

  return (
    <Dialog open={isLoginOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="min-h-[520px] w-full md:w-[90vw] lg:w-[780px] max-w-[95vw] p-0 overflow-hidden bg-background border border-border">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('common:loginRegister')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row">
          {/* 左侧：微信登录区域 */}
          <div className="flex-1 p-4 md:p-8 flex flex-col items-center justify-center hidden md:flex">
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
              {t('common:welcomeTo')}
              <img src="/aimoda-logo.svg" alt="aimoda" className="dark:hidden h-6" />
              <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden dark:block h-6" />
            </h2>
            <div className="my-8">
              <QRCodeSVG
                value={WECHAT_QR_URL}
                size={200}
                level="H"
                includeMargin={true}
              />
            </div>
            <p className="text-sm text-muted-foreground">{t('common:addWechatMember')}</p>
          </div>

          {/* 右侧：登录表单 */}
          <div className="flex-1 p-4 md:p-8 flex flex-col justify-center">
            <h2 className="text-xl sm:text-2xl font-semibold mb-6">
              {showSmsLogin ? t('common:smsLogin') : t('common:emailLogin')}
            </h2>

            {/* 错误提示 */}
            {error && (
              <div className="rounded-md bg-warning/15 border border-warning/30 p-3 text-sm text-warning flex items-center gap-2 mb-4">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                {error}
              </div>
            )}

            {/* ── Email + Password 表单 (主登录方式) ──────────────────── */}
            {!showSmsLogin && (
              <form ref={formRef} onSubmit={handleEmailLogin} className="space-y-3 sm:space-y-4">
                <div className="space-y-2">
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder={t('common:enterEmail')}
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="pl-9 h-10 sm:h-11"
                      required
                      disabled={isLoading}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="password"
                      placeholder={t('common:enterPassword')}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pl-9 h-10 sm:h-11"
                      required
                      disabled={isLoading}
                      autoComplete="current-password"
                    />
                  </div>
                </div>

                {/* 登录按钮 */}
                <Button
                  type="submit"
                  disabled={isLoading || !email || !password}
                  className="w-full h-11 bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/90 cursor-pointer"
                >
                  {isLoading ? t('common:loggingIn') : t('common:login')}
                </Button>

                {/* 自动登录选项 */}
                <div className="flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoLogin}
                      onChange={e => setAutoLogin(e.target.checked)}
                      className="w-4 h-4"
                      disabled={isLoading}
                    />
                    <span>{t('common:thirtyDayLogin')}</span>
                  </label>
                </div>

                {/* 底部说明 */}
                <div className="text-xs text-muted-foreground space-y-1 pt-2 flex flex-col items-center">
                  <p>{t('common:autoRegister')}</p>
                  <p>
                    {t('common:agreeToTerms')}{' '}
                    <a href="#" className="text-destructive hover:underline" onClick={e => e.preventDefault()}>{t('common:userAgreement')}</a>
                    {' '}{' '}
                    <a href="#" className="text-destructive hover:underline" onClick={e => e.preventDefault()}>{t('common:privacyPolicy')}</a>
                  </p>
                </div>

                {/* SMS 备用登录入口 */}
                <div className="text-sm text-center pt-2">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onClick={() => { setShowSmsLogin(true); setError(null) }}
                    disabled={isLoading}
                  >
                    {t('common:useSmsLogin')}
                  </button>
                </div>
              </form>
            )}

            {/* ── SMS 登录表单 (可折叠备用方案) ─────────────────────────── */}
            {showSmsLogin && (
              <form ref={formRef} onSubmit={handleSmsLogin} className="space-y-3 sm:space-y-4">
                {/* 账号输入 */}
                <div className="space-y-2">
                  <Input
                    type="text"
                    placeholder={t('common:enterPhone')}
                    value={smsAccount}
                    onChange={e => setSmsAccount(e.target.value)}
                    className="h-10 sm:h-11"
                    required
                    disabled={isLoading}
                  />
                </div>

                {/* 验证码输入 */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="text"
                        placeholder={t('common:enterCode')}
                        value={verificationCode}
                        onChange={e => setVerificationCode(e.target.value)}
                        className="pl-9 h-10 sm:h-11"
                        required
                        disabled={isLoading}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSendCode}
                      disabled={isSendingCode || countdown > 0 || isLoading}
                      className="h-11 whitespace-nowrap cursor-pointer"
                    >
                      {isSendingCode ? t('common:sending') : countdown > 0
                        ? i18n.language === 'zh-CN'
                          ? `${countdown}${t('common:resendCountdown')}`
                          : t('common:resendCountdown', { n: countdown })
                        : t('common:sendCode')}
                    </Button>
                  </div>
                </div>

                {/* 没收到验证码链接 */}
                <div className="text-sm flex justify-end">
                  <button
                    type="button"
                    className="text-primary hover:underline cursor-pointer"
                    disabled={isLoading}
                  >
                    {t('common:notReceivedCode')}
                  </button>
                </div>

                {/* 登录/注册按钮 */}
                <Button
                  type="submit"
                  disabled={isLoading || !smsAccount || !verificationCode}
                  className="w-full h-11 bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/90 cursor-pointer"
                >
                  {isLoading ? t('common:loggingIn') : t('common:loginRegister')}
                </Button>

                {/* 自动登录选项 */}
                <div className="flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoLogin}
                      onChange={e => setAutoLogin(e.target.checked)}
                      className="w-4 h-4"
                      disabled={isLoading}
                    />
                    <span>{t('common:thirtyDayLogin')}</span>
                  </label>
                </div>

                {/* 底部说明 */}
                <div className="text-xs text-muted-foreground space-y-1 pt-2 flex flex-col items-center">
                  <p>{t('common:autoRegister')}</p>
                  <p>
                    {t('common:agreeToTerms')}{' '}
                    <a href="#" className="text-destructive hover:underline" onClick={e => e.preventDefault()}>{t('common:userAgreement')}</a>
                    {' '}{' '}
                    <a href="#" className="text-destructive hover:underline" onClick={e => e.preventDefault()}>{t('common:privacyPolicy')}</a>
                  </p>
                </div>

                {/* 返回邮箱登录入口 */}
                <div className="text-sm text-center pt-2">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onClick={() => { setShowSmsLogin(false); setError(null) }}
                    disabled={isLoading}
                  >
                    {t('common:useEmailLogin')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
