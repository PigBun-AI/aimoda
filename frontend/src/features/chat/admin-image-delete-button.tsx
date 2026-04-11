import { useState, type MouseEvent } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getApiErrorMessage } from '@/lib/api'
import { getSessionUser } from '@/features/auth/protected-route'
import { cn } from '@/lib/utils'

import { deleteCatalogImage } from './chat-api'

interface AdminImageDeleteButtonProps {
  imageId: string
  brand?: string | null
  className?: string
  onDeleted?: (imageId: string) => void
}

export function AdminImageDeleteButton({
  imageId,
  brand,
  className,
  onDeleted,
}: AdminImageDeleteButtonProps) {
  const { t } = useTranslation('common')
  const [isDeleting, setIsDeleting] = useState(false)
  const sessionUser = getSessionUser()
  const isAdmin = sessionUser?.role === 'admin' && sessionUser.permissions.includes('users:manage')

  if (!isAdmin || !imageId) {
    return null
  }

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    if (isDeleting) return

    const targetLabel = brand?.trim() || imageId
    const confirmed = window.confirm(t('deleteCatalogImageConfirm', { target: targetLabel }))
    if (!confirmed) return

    setIsDeleting(true)
    try {
      await deleteCatalogImage(imageId)
      onDeleted?.(imageId)
    } catch (error) {
      window.alert(getApiErrorMessage(error, t('deleteCatalogImageFailed')))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDeleting}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-none border border-border/80 bg-background/92 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-destructive/35 hover:text-destructive disabled:pointer-events-none disabled:opacity-70',
        className,
      )}
      aria-label={t('deleteCatalogImage')}
      title={t('deleteCatalogImage')}
    >
      {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
    </button>
  )
}
