import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useRedeemCode } from '@/features/redemption/use-redeem'

export function RedeemDialog() {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const mutation = useRedeemCode()
  const queryClient = useQueryClient()

  function handleRedeem() {
    if (!code.trim()) return
    setSuccessMessage('')
    mutation.mutate(
      { code: code.trim() },
      {
        onSuccess: (data) => {
          const endsAt = new Date(data.subscription.endsAt).toLocaleDateString('zh-CN')
          setSuccessMessage(`${t('redeemSuccess')} ${endsAt}`)
          setCode('')
          queryClient.invalidateQueries({ queryKey: ['my-subscription'] })
        },
      },
    )
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setCode('')
      setSuccessMessage('')
      mutation.reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sm bg-transparent hover:bg-[var(--bg-tertiary)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('redeemCode')}
        </Button>
      </DialogTrigger>
      <DialogContent
        style={{
          backgroundColor: 'var(--bg-primary)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)',
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--text-primary)' }}>{t('redeemSubscription')}</DialogTitle>
          <DialogDescription style={{ color: 'var(--text-muted)' }}>
            {t('redeemHint')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Input
            placeholder={t('enterCode')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-12 font-mono"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-primary)',
            }}
          />
          {successMessage && (
            <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>
          )}
          {mutation.isError && (
            <p className="text-sm text-red-500">{t('redeemFailed')}</p>
          )}
          <Button
            onClick={handleRedeem}
            disabled={mutation.isPending || !code.trim()}
            className="w-full h-10"
            style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
          >
            {mutation.isPending ? `${t('redeem')}...` : t('redeem')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
