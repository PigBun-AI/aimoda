import { type ReactNode, useCallback } from 'react'
import { Download, Heart, Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ImageResult } from './chat-types'

interface ImageActionBarProps {
  image: ImageResult
}

export function ImageActionBar({ image }: ImageActionBarProps) {
  const { t } = useTranslation('common')

  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = image.image_url
    a.download = `${image.image_id}-${image.brand || 'fashion'}.jpg`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [image])

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(image.image_url)
    } catch {
      // silent fail
    }
  }, [image])

  return (
    <div className="flex w-full shrink-0 flex-row items-stretch justify-between gap-0 lg:h-full lg:w-[88px] lg:flex-col">
      <ActionButton
        icon={<Link2 className="h-[18px] w-[18px]" strokeWidth={1.5} />}
        label={t('copyLink')}
        onClick={handleCopyLink}
      />
      <ActionButton
        icon={<Download className="h-[18px] w-[18px]" strokeWidth={1.5} />}
        label={t('download')}
        onClick={handleDownload}
      />
      <ActionButton
        icon={<Heart className="h-[18px] w-[18px]" strokeWidth={1.5} />}
        label={t('favorite')}
      />
    </div>
  )
}

interface ActionButtonProps {
  icon: ReactNode
  label: string
  onClick?: () => void
}

function ActionButton({ icon, label, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[76px] flex-1 flex-col items-center justify-center gap-2 border-t border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground first:border-t-0 lg:border-b lg:border-t-0"
      title={label}
      aria-label={label}
    >
      {icon}
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em]">{label}</span>
    </button>
  )
}
