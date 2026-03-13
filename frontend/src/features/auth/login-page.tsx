import { FormEvent, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login } from '@/lib/api'

import { saveSession } from './protected-route'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('admin@fashion-report.local')
  const [password, setPassword] = useState('ChangeMe123!')
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/reports'

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      saveSession(JSON.stringify(user))
      navigate(redirectTo, { replace: true })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate({ email, password })
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Left side - Brand */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 border-r"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border-color)'
        }}
      >
        <div className="max-w-md">
          <div className="mb-8">
            <p
              className="text-xs tracking-[0.3em] uppercase mb-3"
              style={{ color: 'var(--text-muted)' }}
            >
              World Wear Watch Daily
            </p>
            <h1 className="mb-4">
              <img src="/WWWD_logo_clean.svg" alt="WWWD" className="dark:hidden" style={{ height: '56px' }} />
              <img src="/WWWD_logo_inverted.svg" alt="WWWD" className="hidden dark:block" style={{ height: '56px' }} />
            </h1>
            <div
              className="w-12 h-px mb-6"
              style={{ backgroundColor: 'var(--border-color)' }}
            ></div>
            <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              时尚趋势洞察日报，汇聚全球时装周精华，助您把握市场脉搏，做出明智决策。
            </p>
          </div>
          <div className="space-y-3 text-sm" style={{ color: 'var(--text-muted)' }}>
            <p>· 实时趋势解读</p>
            <p>· 精细化买手指南</p>
            <p>· 全链路数据分析</p>
          </div>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div
        className="flex-1 flex items-center justify-center px-6 py-10"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10 text-center">
            <img src="/WWWD_logo_clean.svg" alt="WWWD" className="dark:hidden mx-auto" style={{ height: '36px' }} />
            <img src="/WWWD_logo_inverted.svg" alt="WWWD" className="hidden dark:block mx-auto" style={{ height: '36px' }} />
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              欢迎回来
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              使用团队账号登录管理平台
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                邮箱
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-12"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                密码
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="h-12"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {mutation.isError && (
              <p className="text-sm text-red-500">登录失败，请稍后重试。</p>
            )}

            <Button
              className="w-full h-12"
              style={{
                backgroundColor: 'var(--text-primary)',
                color: 'var(--bg-primary)',
              }}
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? '登录中...' : '登录'}
            </Button>
          </form>

          <p
            className="mt-6 text-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            没有账号？{' '}
            <Link to="/register" className="underline" style={{ color: 'var(--text-primary)' }}>
              注册
            </Link>
          </p>

          <p
            className="mt-8 text-center text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            &copy; 2026 World Wear Watch Daily. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}