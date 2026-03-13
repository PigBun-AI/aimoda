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
          setSuccessMessage(`兑换成功！订阅有效期至 ${endsAt}`)
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
          兑换码
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
          <DialogTitle style={{ color: 'var(--text-primary)' }}>兑换订阅</DialogTitle>
          <DialogDescription style={{ color: 'var(--text-muted)' }}>
            输入兑换码以激活或延长订阅
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Input
            placeholder="请输入兑换码"
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
            <p className="text-sm text-red-500">兑换失败，请检查兑换码是否正确。</p>
          )}
          <Button
            onClick={handleRedeem}
            disabled={mutation.isPending || !code.trim()}
            className="w-full h-10"
            style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
          >
            {mutation.isPending ? '兑换中...' : '兑换'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
