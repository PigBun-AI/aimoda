import { useTranslation } from 'react-i18next'
import { useState, useCallback } from 'react'
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

  const handleRedeem = useCallback(() => {
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
  }, [code, mutation, queryClient, t])

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
          className="w-full justify-start gap-2 text-sm bg-transparent hover:bg-accent text-muted-foreground"
        >
          {t('redeemCode')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>{t('redeemSubscription')}</DialogTitle>
          <DialogDescription style={{ color: 'var(--muted-foreground)' }}>
            {t('redeemHint')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Input
            placeholder={t('enterCode')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-10 sm:h-12 font-mono"
          />
          {successMessage && (
            <p className="text-sm" style={{ color: 'var(--success)' }}>{successMessage}</p>
          )}
          {mutation.isError && (
            <p className="text-sm text-destructive">{t('redeemFailed')}</p>
          )}
          <Button
            onClick={handleRedeem}
            disabled={mutation.isPending || !code.trim()}
            className="h-10 sm:h-11"
          >
            {mutation.isPending ? `${t('redeem')}...` : t('redeem')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
