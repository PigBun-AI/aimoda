import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Heart, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ImageResult } from '@/features/chat/chat-types'
import { cn } from '@/lib/utils'
import {
  addImageToFavoriteCollection,
  createFavoriteCollection,
  listFavoriteCollections,
  lookupFavoriteCollections,
  removeImageFromFavoriteCollection,
  type FavoriteCollection,
} from './favorites-api'

interface FavoriteImageDialogProps {
  image: ImageResult
  open: boolean
  onOpenChange: (open: boolean) => void
  onCollectionsChanged?: (collectionIds: string[]) => void
}

function normalizeMetaValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || null
  }
  if (Array.isArray(value)) {
    const parts = value
      .map(item => normalizeMetaValue(item))
      .filter((item): item is string => Boolean(item))
    return parts.length > 0 ? Array.from(new Set(parts)).join(' / ') : null
  }
  const normalized = String(value).trim()
  return normalized || null
}

export function FavoriteImageDialog({
  image,
  open,
  onOpenChange,
  onCollectionsChanged,
}: FavoriteImageDialogProps) {
  const { t } = useTranslation('common')
  const [collections, setCollections] = useState<FavoriteCollection[]>([])
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isMutating, setIsMutating] = useState<string | null>(null)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const onCollectionsChangedRef = useRef(onCollectionsChanged)

  useEffect(() => {
    onCollectionsChangedRef.current = onCollectionsChanged
  }, [onCollectionsChanged])

  const payload = useMemo(() => ({
    image_id: image.image_id,
    image_url: image.image_url,
    brand: normalizeMetaValue(image.brand) ?? undefined,
    year: typeof image.year === 'number' ? image.year : image.year ? Number(image.year) : null,
    quarter: normalizeMetaValue(image.quarter) ?? undefined,
    season: normalizeMetaValue(image.season) ?? undefined,
    gender: normalizeMetaValue(image.gender) ?? undefined,
  }), [image])

  useEffect(() => {
    // Fetching should be driven only by dialog lifecycle + image identity.
    // Parent callback identity changes must not trigger a refetch storm.
    if (!open) return
    setIsLoading(true)
    setMessage(null)
    setSelectedCollectionIds([])
    Promise.all([
      listFavoriteCollections(),
      lookupFavoriteCollections(image.image_id),
    ])
      .then(([allCollections, matchedCollections]) => {
        setCollections(allCollections)
        setSelectedCollectionIds(matchedCollections.map(item => item.id))
      })
      .catch(error => {
        setMessage(error instanceof Error ? error.message : t('favoriteCollectionsLoadFailed'))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [image.image_id, open, t])

  useEffect(() => {
    if (!open) return
    onCollectionsChangedRef.current?.(selectedCollectionIds)
  }, [open, selectedCollectionIds])

  const handleToggleCollection = async (collection: FavoriteCollection) => {
    setMessage(null)
    setIsMutating(collection.id)
    try {
      const alreadySaved = selectedCollectionIds.includes(collection.id)
      if (alreadySaved) {
        await removeImageFromFavoriteCollection(collection.id, image.image_id)
      } else {
        await addImageToFavoriteCollection(collection.id, payload)
      }

      const matchedCollections = await lookupFavoriteCollections(image.image_id)
      const nextSelected = matchedCollections.map(item => item.id)
      setSelectedCollectionIds(nextSelected)

      const refreshedCollections = await listFavoriteCollections()
      setCollections(refreshedCollections)
      setMessage(alreadySaved ? t('favoriteRemovedMessage') : t('favoriteSavedMessage'))
      onOpenChange(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteActionFailed'))
    } finally {
      setIsMutating(null)
    }
  }

  const handleCreateAndAdd = async () => {
    const trimmedName = newCollectionName.trim()
    if (!trimmedName) return

    setMessage(null)
    setIsMutating('create')
    try {
      const collection = await createFavoriteCollection({ name: trimmedName })
      await addImageToFavoriteCollection(collection.id, payload)
      const [refreshedCollections, matchedCollections] = await Promise.all([
        listFavoriteCollections(),
        lookupFavoriteCollections(image.image_id),
      ])
      const nextSelected = matchedCollections.map(item => item.id)
      setCollections(refreshedCollections)
      setSelectedCollectionIds(nextSelected)
      setNewCollectionName('')
      setMessage(t('favoriteCreatedAndSaved'))
      onOpenChange(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteCreateFailed'))
    } finally {
      setIsMutating(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] rounded-none border-border/80">
        <DialogHeader>
          <DialogTitle>{t('favoriteDialogTitle')}</DialogTitle>
          <DialogDescription>{t('favoriteDialogHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={newCollectionName}
              onChange={event => setNewCollectionName(event.target.value)}
              placeholder={t('favoriteCollectionNamePlaceholder')}
              className="rounded-none"
            />
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={() => void handleCreateAndAdd()}
              disabled={isMutating === 'create' || !newCollectionName.trim()}
            >
              {isMutating === 'create' ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
              {t('favoriteCreateCollection')}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="type-chat-kicker text-muted-foreground">{t('favoriteExistingCollections')}</div>
            <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-1">
              {isLoading && (
                <div className="flex min-h-[160px] items-center justify-center border border-border/80">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {!isLoading && collections.length === 0 && (
                <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 border border-dashed border-border/80 px-6 text-center">
                  <Heart className="size-4 text-muted-foreground" />
                  <p className="type-chat-meta text-muted-foreground">{t('favoriteCollectionsEmpty')}</p>
                </div>
              )}

              {!isLoading && collections.map(collection => {
                const isSelected = selectedCollectionIds.includes(collection.id)
                const isBusy = isMutating === collection.id
                return (
                  <button
                    key={collection.id}
                    type="button"
                    onClick={() => void handleToggleCollection(collection)}
                    className={cn(
                      'grid gap-3 border px-4 py-4 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_auto]',
                      isSelected
                        ? 'border-foreground text-foreground'
                        : 'border-border/80 text-foreground hover:border-foreground/30',
                    )}
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="type-chat-label truncate">{collection.name}</span>
                        {(collection.can_apply_as_dna ?? collection.can_apply_as_taste) && (
                          <span className="type-chat-kicker border border-border px-2 py-1 text-muted-foreground">
                            {t('favoriteTasteReady')}
                          </span>
                        )}
                      </div>
                      <p className="type-chat-meta text-muted-foreground">
                        {t('favoriteCollectionCount', { count: collection.item_count })}
                      </p>
                    </div>

                    <div className="flex items-center justify-end">
                      {isBusy ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : isSelected ? (
                        <span className="inline-flex items-center gap-2 text-foreground">
                          <Check className="size-4" />
                          <span className="type-chat-kicker">{t('favoriteSaved')}</span>
                        </span>
                      ) : (
                        <span className="type-chat-kicker text-muted-foreground">{t('favoriteAdd')}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {message && (
            <div className="type-chat-meta border border-border/80 px-4 py-3 text-muted-foreground">
              {message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-none" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
