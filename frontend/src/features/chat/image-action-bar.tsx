import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Download, Heart, Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ImageResult } from './chat-types'
import { copyImageAssetLink, downloadImageAsset } from './image-download'
import { FavoriteImageDialog } from '@/features/favorites/favorite-image-dialog'
import { lookupFavoriteCollections } from '@/features/favorites/favorites-api'

interface ImageActionBarProps {
  image: ImageResult
}

export function ImageActionBar({ image }: ImageActionBarProps) {
  const { t } = useTranslation('common')
  const [isFavoriteDialogOpen, setIsFavoriteDialogOpen] = useState(false)
  const [favoriteCollectionIds, setFavoriteCollectionIds] = useState<string[]>([])

  const handleDownload = useCallback(() => {
    void downloadImageAsset(image.image_url, `${image.image_id}-${image.brand || 'fashion'}.jpg`)
  }, [image])

  const handleCopyLink = useCallback(async () => {
    await copyImageAssetLink(image.image_url)
  }, [image])

  useEffect(() => {
    if (Array.isArray(image.favorite_collection_ids)) {
      setFavoriteCollectionIds(image.favorite_collection_ids)
      return
    }
    if (image.is_favorited === false) {
      setFavoriteCollectionIds([])
      return
    }
    lookupFavoriteCollections(image.image_id)
      .then(collections => setFavoriteCollectionIds(collections.map(collection => collection.id)))
      .catch(() => setFavoriteCollectionIds([]))
  }, [image.favorite_collection_ids, image.image_id, image.is_favorited])

  return (
    <>
      <div className="flex w-full shrink-0 flex-row items-stretch justify-between gap-0 xl:h-full xl:w-[88px] xl:flex-col">
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
          icon={(
            <Heart
              className="h-[18px] w-[18px]"
              strokeWidth={1.5}
              fill={favoriteCollectionIds.length > 0 ? 'currentColor' : 'none'}
            />
          )}
          label={t('favorite')}
          onClick={() => setIsFavoriteDialogOpen(true)}
        />
      </div>

      <FavoriteImageDialog
        image={image}
        open={isFavoriteDialogOpen}
        onOpenChange={setIsFavoriteDialogOpen}
        onCollectionsChanged={setFavoriteCollectionIds}
      />
    </>
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
      className="flex min-h-[64px] flex-1 flex-col items-center justify-center gap-2 border-t border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground first:border-t-0 sm:min-h-[72px] xl:min-h-0 xl:border-b xl:border-t-0"
      title={label}
      aria-label={label}
    >
      {icon}
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em]">{label}</span>
    </button>
  )
}
