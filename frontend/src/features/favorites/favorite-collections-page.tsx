import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Heart,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PageFrame } from '@/components/layout/page-frame'
import { PageIntro } from '@/components/layout/page-intro'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { subscribeToCatalogImageDeleted } from '@/features/images/image-lifecycle'
import { cn } from '@/lib/utils'
import {
  createFavoriteCollection,
  deleteFavoriteCollection,
  getActiveFavoriteCollectionUploadJob,
  getFavoriteCollection,
  getFavoriteCollectionUploadJob,
  listFavoriteCollections,
  removeImageFromFavoriteCollection,
  removeImagesFromFavoriteCollection,
  startFavoriteCollectionUploadBatch,
  updateFavoriteCollection,
  type FavoriteCollection,
  type FavoriteCollectionDetail,
  type FavoriteCollectionUploadBatchProgress,
  type FavoriteCollectionItem,
  type FavoriteCollectionUploadJob,
} from './favorites-api'

const PAGE_SIZE = 24
const ACTIVE_UPLOAD_JOB_STATUSES = new Set(['pending', 'uploading', 'queued', 'processing'])
const TERMINAL_UPLOAD_JOB_STATUSES = new Set(['completed', 'partial_failed', 'failed'])
const ACCEPTED_UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const COLLECTION_TEXTAREA_CLASS =
  'w-full resize-y rounded-none border border-input bg-background px-4 py-3 type-ui-body-sm text-foreground transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/30 focus:border-foreground focus:outline-none'
const COLLECTION_ICON_BUTTON_CLASS =
  'control-icon-sm flex items-center justify-center rounded-none border border-border/80 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground'
const FAVORITE_INLINE_ACTION_CLASS = 'type-chat-kicker inline-flex items-center gap-2 transition-colors'
const FAVORITE_STATUS_ICON_CLASS = 'size-4'

function normalizeUploadFiles(files: FileList | File[] | null) {
  const entries = files instanceof FileList ? Array.from(files) : (files ?? [])
  const acceptedFiles = entries.filter(file => ACCEPTED_UPLOAD_MIME_TYPES.has((file.type || '').toLowerCase()))
  return {
    acceptedFiles,
    rejectedCount: Math.max(0, entries.length - acceptedFiles.length),
  }
}

function isFileDrag(event: Pick<DragEvent, 'dataTransfer'>) {
  return Array.from(event.dataTransfer.types ?? []).includes('Files')
}

function formatCollectionTimestamp(value: string | null | undefined, language: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    month: language === 'zh-CN' ? '2-digit' : 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: language !== 'zh-CN',
  }).format(date)
}

function buildCollectionItemMeta(item: FavoriteCollectionItem, fallback: string) {
  const segments = [item.year, item.season, item.quarter].filter(Boolean)
  return segments.length > 0 ? segments.join(' / ') : fallback
}

function resolveUploadJobTone(status: string) {
  if (status === 'completed') return 'text-foreground'
  if (status === 'partial_failed' || status === 'failed') return 'text-destructive'
  return 'text-muted-foreground'
}

function removeDeletedPreviewItems<T extends { image_id: string }>(items: T[] | undefined, imageId: string) {
  return (items ?? []).filter(item => item.image_id !== imageId)
}

export function FavoriteCollectionsPage() {
  const { t, i18n } = useTranslation('common')
  const [collections, setCollections] = useState<FavoriteCollection[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<FavoriteCollectionDetail | null>(null)
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isLoadingMoreDetail, setIsLoadingMoreDetail] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadJob, setUploadJob] = useState<FavoriteCollectionUploadJob | null>(null)
  const [uploadBatchProgress, setUploadBatchProgress] = useState<FavoriteCollectionUploadBatchProgress | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isDeleteCollectionConfirmOpen, setIsDeleteCollectionConfirmOpen] = useState(false)
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')
  const [isDropActive, setIsDropActive] = useState(false)
  const [isUploadQueueOpen, setIsUploadQueueOpen] = useState(false)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([])
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const detailScrollViewportRef = useRef<HTMLDivElement | null>(null)
  const detailLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const detailLoadInFlightRef = useRef(false)
  const handledTerminalUploadJobsRef = useRef<Set<string>>(new Set())
  const dragDepthRef = useRef(0)

  const selectedCollection = useMemo(
    () => collections.find(collection => collection.id === selectedId) ?? null,
    [collections, selectedId],
  )
  const hasActiveUploadJob = uploadJob ? ACTIVE_UPLOAD_JOB_STATUSES.has(uploadJob.status) : false

  const syncList = async (preferredId?: string | null) => {
    setIsLoadingList(true)
    try {
      const data = await listFavoriteCollections()
      setCollections(data)
      const nextId = preferredId ?? selectedId
      const resolvedId = nextId && data.some(item => item.id === nextId)
        ? nextId
        : data[0]?.id ?? null
      setSelectedId(resolvedId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteCollectionsLoadFailed'))
    } finally {
      setIsLoadingList(false)
    }
  }

  const loadDetail = async (
    collectionId: string,
    options: {
      offset?: number
      limit?: number
      mode?: 'replace' | 'append'
    } = {},
  ) => {
    const offset = options.offset ?? 0
    const limit = options.limit ?? PAGE_SIZE
    const mode = options.mode ?? 'replace'
    if (mode === 'append') {
      detailLoadInFlightRef.current = true
    }

    if (mode === 'append') {
      setIsLoadingMoreDetail(true)
    } else {
      setIsLoadingDetail(true)
    }
    try {
      const detail = await getFavoriteCollection(collectionId, offset, limit)
      setSelectedDetail((current) => {
        if (mode === 'append' && current && current.id === detail.id) {
          const existingIds = new Set(current.items.map(item => item.image_id))
          const nextItems = detail.items.filter(item => !existingIds.has(item.image_id))
          return {
            ...detail,
            items: [...current.items, ...nextItems],
            offset: 0,
          }
        }

        return {
          ...detail,
          offset: 0,
        }
      })
      if (mode === 'replace') {
        setDraftName(detail.name)
        setDraftDescription(detail.description)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteCollectionDetailFailed'))
    } finally {
      if (mode === 'append') {
        detailLoadInFlightRef.current = false
        setIsLoadingMoreDetail(false)
      } else {
        setIsLoadingDetail(false)
      }
    }
  }

  const reloadSelectedDetail = async (collectionId: string, preserveLoaded = true) => {
    const limit = preserveLoaded && selectedDetail
      ? Math.max(PAGE_SIZE, selectedDetail.items.length)
      : PAGE_SIZE
    await loadDetail(collectionId, { offset: 0, limit, mode: 'replace' })
  }

  const loadActiveUploadJob = async (collectionId: string) => {
    try {
      const job = await getActiveFavoriteCollectionUploadJob(collectionId)
      setUploadJob(job)
    } catch {
      setUploadJob(null)
    }
  }

  useEffect(() => {
    void syncList()
  }, [])

  useEffect(() => {
    return subscribeToCatalogImageDeleted((detail) => {
      if (detail.affectedFavoriteCollectionIds.length === 0) return

      const affectedCollectionIds = new Set(detail.affectedFavoriteCollectionIds)
      const deletedImageId = detail.imageId

      setCollections(prev => prev.map((collection) => {
        if (!affectedCollectionIds.has(collection.id)) return collection

        const nextPreviewItems = removeDeletedPreviewItems(collection.preview_items, deletedImageId)
        const coverRemoved = collection.cover_image_id === deletedImageId

        return {
          ...collection,
          item_count: Math.max(0, collection.item_count - 1),
          preview_items: nextPreviewItems,
          cover_image_id: coverRemoved ? (nextPreviewItems[0]?.image_id ?? null) : collection.cover_image_id,
          cover_image_url: coverRemoved ? (nextPreviewItems[0]?.image_url ?? null) : collection.cover_image_url,
        }
      }))

      setSelectedDetail(prev => {
        if (!prev || !affectedCollectionIds.has(prev.id)) return prev
        const nextItems = prev.items.filter(item => item.image_id !== deletedImageId)
        if (nextItems.length === prev.items.length) return prev

        return {
          ...prev,
          items: nextItems,
          item_count: Math.max(0, prev.item_count - 1),
          has_more: Math.max(0, prev.item_count - 1) > nextItems.length || prev.has_more,
        }
      })
      setSelectedImageIds(prev => prev.filter(imageId => imageId !== deletedImageId))

      void syncList(selectedId)
      if (selectedId && affectedCollectionIds.has(selectedId)) {
        void reloadSelectedDetail(selectedId)
      }
    })
  }, [reloadSelectedDetail, selectedId, syncList])

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null)
      setUploadJob(null)
      setUploadBatchProgress(null)
      setIsDropActive(false)
      setIsUploadQueueOpen(false)
      setIsSelectionMode(false)
      setSelectedImageIds([])
      setDraftName('')
      setDraftDescription('')
      return
    }
    setUploadBatchProgress(null)
    setIsDropActive(false)
    setIsUploadQueueOpen(false)
    setIsSelectionMode(false)
    setSelectedImageIds([])
    void loadDetail(selectedId, { offset: 0, mode: 'replace' })
    void loadActiveUploadJob(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!uploadJob || !selectedId || uploadJob.collection_id !== selectedId) return

    if (TERMINAL_UPLOAD_JOB_STATUSES.has(uploadJob.status) && !handledTerminalUploadJobsRef.current.has(uploadJob.id)) {
      handledTerminalUploadJobsRef.current.add(uploadJob.id)
      setIsUploadQueueOpen(false)
      if (uploadJob.completed_count > 0) {
        void Promise.all([
          syncList(selectedId),
          reloadSelectedDetail(selectedId),
        ])
      }

      if (uploadJob.status === 'completed') {
        setMessage(t('favoriteUploadBatchCompleted', { count: uploadJob.completed_count }))
      } else if (uploadJob.status === 'partial_failed') {
        setMessage(t('favoriteUploadBatchPartialFailed', {
          completed: uploadJob.completed_count,
          failed: uploadJob.failed_count,
        }))
      } else {
        setMessage(uploadJob.error_message || t('favoriteUploadBatchFailed'))
      }
      return
    }

    if (!ACTIVE_UPLOAD_JOB_STATUSES.has(uploadJob.status)) return

    const interval = window.setInterval(async () => {
      try {
        const nextJob = await getFavoriteCollectionUploadJob(uploadJob.id)
        setUploadJob(nextJob)
      } catch {
        window.clearInterval(interval)
      }
    }, 1500)

    return () => window.clearInterval(interval)
  }, [reloadSelectedDetail, selectedId, t, uploadJob])

  const handleCreateCollection = async () => {
    const name = newCollectionName.trim()
    if (!name) return

    setIsSaving(true)
    setMessage(null)
    try {
      const created = await createFavoriteCollection({
        name,
        description: newCollectionDescription.trim(),
      })
      setIsCreateOpen(false)
      setNewCollectionName('')
      setNewCollectionDescription('')
      await syncList(created.id)
      setMessage(t('favoriteCollectionCreated'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteCreateFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async () => {
    if (!selectedId) return
    setIsSaving(true)
    setMessage(null)
    try {
      await updateFavoriteCollection(selectedId, {
        name: draftName.trim(),
        description: draftDescription.trim(),
      })
      await Promise.all([
        syncList(selectedId),
        reloadSelectedDetail(selectedId),
      ])
      setMessage(t('favoriteCollectionSaved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteCollectionSaveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedId) return
    setIsSaving(true)
    setMessage(null)
    try {
      await deleteFavoriteCollection(selectedId)
      setSelectedDetail(null)
      setIsDeleteCollectionConfirmOpen(false)
      await syncList(null)
      setMessage(t('favoriteCollectionDeleted'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteCollectionDeleteFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemoveItem = async (item: FavoriteCollectionItem) => {
    if (!selectedId || !selectedDetail) return
    setIsSaving(true)
    setMessage(null)
    try {
      await removeImageFromFavoriteCollection(selectedId, item.image_id)
      await Promise.all([
        syncList(selectedId),
        reloadSelectedDetail(selectedId),
      ])
      setMessage(t('favoriteItemRemoved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteItemRemoveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleSelectionMode = () => {
    setIsSelectionMode(current => {
      const next = !current
      if (!next) {
        setSelectedImageIds([])
      }
      return next
    })
  }

  const handleToggleItemSelection = (imageId: string) => {
    setSelectedImageIds(current => (
      current.includes(imageId)
        ? current.filter(id => id !== imageId)
        : [...current, imageId]
    ))
  }

  const handleToggleSelectAll = () => {
    if (!selectedDetail) return
    const selectableIds = selectedDetail.items.map(item => item.image_id)
    setSelectedImageIds(current => (
      current.length === selectableIds.length ? [] : selectableIds
    ))
  }

  const handleBulkRemoveItems = async () => {
    if (!selectedId || !selectedDetail || selectedImageIds.length === 0) return
    setIsSaving(true)
    setMessage(null)
    try {
      await removeImagesFromFavoriteCollection(selectedId, selectedImageIds)
      setSelectedImageIds([])
      setIsSelectionMode(false)
      setIsBulkDeleteConfirmOpen(false)
      await Promise.all([
        syncList(selectedId),
        reloadSelectedDetail(selectedId),
      ])
      setMessage(t('favoriteItemsRemoved', { count: selectedImageIds.length }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteItemRemoveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleUploadFiles = async (files: FileList | null) => {
    if (!selectedId || !files || files.length === 0) return

    const { acceptedFiles, rejectedCount } = normalizeUploadFiles(files)
    if (acceptedFiles.length === 0) {
      setMessage(t('favoriteUploadUnsupportedFiles'))
      return
    }

    setIsUploading(true)
    setMessage(null)
    setIsUploadQueueOpen(false)
    try {
      const nextJob = await startFavoriteCollectionUploadBatch(selectedId, acceptedFiles, {
        onUpdate: (job) => {
          setUploadJob(job)
        },
        onBatchUpdate: (progress) => {
          setUploadBatchProgress(progress)
        },
      })
      setUploadJob(nextJob)
      if (rejectedCount > 0) {
        const filteredMessage = t('favoriteUploadFilteredFiles', { count: rejectedCount })
        setMessage(current => (current ? current + ' ' + filteredMessage : filteredMessage))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('favoriteUploadFailed'))
    } finally {
      setIsUploading(false)
      if (uploadInputRef.current) {
        uploadInputRef.current.value = ''
      }
    }
  }

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!selectedCollection || !isFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setIsDropActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!selectedCollection || !isFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    if (!isDropActive) {
      setIsDropActive(true)
    }
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!selectedCollection || !isFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDropActive(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!selectedCollection || !isFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setIsDropActive(false)
    void handleUploadFiles(event.dataTransfer.files)
  }

  const handleLoadMoreDetail = () => {
    if (!selectedId || !selectedDetail || isLoadingDetail || isLoadingMoreDetail || detailLoadInFlightRef.current || !selectedDetail.has_more) return
    void loadDetail(selectedId, {
      offset: selectedDetail.items.length,
      limit: PAGE_SIZE,
      mode: 'append',
    })
  }

  useEffect(() => {
    const viewport = detailScrollViewportRef.current
    const sentinel = detailLoadMoreRef.current
    if (!viewport || !sentinel || !selectedCollection || !selectedDetail?.has_more) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some(entry => entry.isIntersecting)) return
        handleLoadMoreDetail()
      },
      {
        root: viewport,
        rootMargin: '320px 0px 320px 0px',
        threshold: 0,
      },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [selectedCollection, selectedDetail?.has_more, selectedDetail?.items.length, isLoadingDetail, isLoadingMoreDetail])

  return (
    <>
      <PageFrame fullHeight innerClassName="gap-3">
        <PageIntro
          eyebrow={t('favoritesTab')}
          title={t('favoriteCollectionsTitle')}
          titleClassName="max-w-[10ch]"
          aside={(
            <div className="space-y-2">
              <p className="type-body-muted max-w-[48ch] text-pretty text-muted-foreground">
                {t('favoriteCollectionsPageHint')}
              </p>
              <p className="type-chat-kicker text-foreground/84">{t('dnaCollectionsHeroTitle')}</p>
            </div>
          )}
          className="shrink-0"
        />

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(252px,284px)_minmax(0,1fr)]">
          <aside className="flex min-h-[16rem] max-h-[30svh] min-h-0 flex-col overflow-hidden border border-border/80 bg-background xl:max-h-none">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/80 px-3 py-3 sm:px-3.5">
              <div>
                <p className="type-chat-kicker text-muted-foreground">{t('favoriteCollectionsTitle')}</p>
                <p className="mt-1 type-chat-meta text-muted-foreground">{t('favoriteCollectionCount', { count: collections.length })}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void syncList(selectedId)}
                  className={cn(COLLECTION_ICON_BUTTON_CLASS, 'border-transparent')}
                  aria-label={t('favoriteCollectionsRefresh')}
                >
                  <RefreshCw className="size-4" />
                </button>
                <Button type="button" variant="outline" size="sm" className="rounded-none px-3" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="size-4" />
                  {t('favoriteCollectionCreateAction')}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-2.5">
                {isLoadingList && (
                  <div className="flex min-h-[220px] items-center justify-center border border-border/80">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {!isLoadingList && collections.length === 0 && (
                  <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 border border-dashed border-border/80 px-6 text-center">
                    <Heart className="size-4 text-muted-foreground" />
                    <p className="type-chat-meta max-w-[24ch] text-muted-foreground">{t('favoriteCollectionsEmpty')}</p>
                  </div>
                )}

                {!isLoadingList && collections.length > 0 && (
                  <div className="space-y-1.5">
                    {collections.map(collection => {
                      const isActive = selectedId === collection.id
                      return (
                        <button
                          key={collection.id}
                          type="button"
                          onClick={() => setSelectedId(collection.id)}
                          className={cn(
                            'w-full border px-3 py-3 text-left transition-colors',
                            isActive ? 'border-foreground bg-accent/30' : 'border-border/60 hover:border-foreground/24',
                          )}
                        >
                          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_4.75rem] sm:items-start">
                            <div className="min-w-0 space-y-1.5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="type-chat-label truncate text-foreground">{collection.name}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <div className="type-chat-meta text-muted-foreground">
                                      {t('favoriteCollectionCount', { count: collection.item_count })}
                                    </div>
                                    <div className="type-chat-kicker text-muted-foreground/90">
                                      {t('dnaCollectionCardMeta')}
                                    </div>
                                  </div>
                                </div>
                                {(collection.can_apply_as_dna ?? collection.can_apply_as_taste) && (
                                  <span className="type-chat-kicker shrink-0 text-muted-foreground">
                                    {t('favoriteTasteReady')}
                                  </span>
                                )}
                              </div>
                            </div>

                            {collection.preview_items && collection.preview_items.length > 0 && (
                              <div className="grid grid-cols-2 gap-1 self-stretch">
                                {collection.preview_items.slice(0, 4).map((item, index) => (
                                  <div
                                    key={item.image_id + '-' + index}
                                    className="aspect-[4/5] bg-muted/20"
                                    style={{
                                      backgroundImage: item.image_url ? `url(${item.image_url})` : undefined,
                                      backgroundSize: 'cover',
                                      backgroundPosition: 'center',
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
            </div>
          </aside>

            <div
              className={cn(
                'relative flex min-h-0 flex-col overflow-hidden border border-border/80 bg-background transition-colors',
                isDropActive && 'border-foreground',
              )}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {!selectedCollection && (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <div className="space-y-3">
                    <Sparkles className="mx-auto size-4 text-muted-foreground" />
                    <p className="type-chat-meta max-w-[28ch] text-muted-foreground">{t('favoriteCollectionSelectHint')}</p>
                  </div>
                </div>
              )}

              {selectedCollection && (
                <>
                  <div className="shrink-0 border-b border-border/80 px-4 py-4 sm:px-5 sm:py-4 xl:px-6">
                    <div className="grid gap-3 xl:grid-cols-[minmax(15rem,0.85fr)_minmax(18rem,1.15fr)_auto] xl:items-start">
                      <div>
                        <Input
                          value={draftName}
                          onChange={event => setDraftName(event.target.value)}
                          placeholder={t('favoriteCollectionNamePlaceholder')}
                          className="rounded-none"
                        />
                      </div>
                      <textarea
                        value={draftDescription}
                        onChange={event => setDraftDescription(event.target.value)}
                        placeholder={t('favoriteCollectionDescriptionPlaceholder')}
                        className={cn(COLLECTION_TEXTAREA_CLASS, 'min-h-[76px] px-3 py-2.5')}
                      />

                      <div className="flex flex-wrap items-start justify-start gap-1.5 border-t border-border/80 pt-3 xl:justify-end xl:border-t-0 xl:pt-0">
                        <input
                          ref={uploadInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="hidden"
                          onChange={event => void handleUploadFiles(event.target.files)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-none"
                          onClick={() => uploadInputRef.current?.click()}
                          disabled={isUploading || hasActiveUploadJob}
                        >
                          {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                          {hasActiveUploadJob ? t('favoriteUploadInProgressLabel') : t('favoriteUploadAction')}
                        </Button>
                        {(uploadJob || uploadBatchProgress) && (
                          <button
                            type="button"
                            onClick={() => setIsUploadQueueOpen(current => !current)}
                            className={cn(
                              COLLECTION_ICON_BUTTON_CLASS,
                              'relative size-10',
                              isUploadQueueOpen && 'border-foreground text-foreground',
                            )}
                            aria-label={t('favoriteUploadQueueToggle')}
                            title={t('favoriteUploadQueueToggle')}
                          >
                            <Download className="size-4" />
                            {((uploadBatchProgress?.total_files ?? uploadJob?.total_count ?? 0) > 0) && (
                              <span className="type-chat-kicker absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center border border-background bg-foreground px-1.5 py-0.5 text-background">
                                {String(uploadBatchProgress?.total_files ?? uploadJob?.total_count ?? 0).padStart(2, '0')}
                              </span>
                            )}
                          </button>
                        )}
                        <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={() => void handleSave()} disabled={isSaving}>
                          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                          {t('save')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-none"
                          onClick={() => setIsDeleteCollectionConfirmOpen(true)}
                          disabled={isSaving}
                        >
                          <Trash2 className="size-4" />
                          {t('delete')}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-border/80 pt-3">
                      <div className="inline-flex items-center gap-2 border border-border/70 px-2.5 py-1.5">
                        <span className="type-chat-kicker text-muted-foreground">{t('favoriteWorkbenchCountLabel')}</span>
                        <span className="type-chat-label tabular-nums text-foreground">
                          {String(selectedCollection.item_count).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="inline-flex items-center gap-2 border border-border/70 px-2.5 py-1.5">
                        <span className="type-chat-kicker text-muted-foreground">{t('favoriteWorkbenchStatusLabel')}</span>
                        <span className="type-chat-meta text-foreground">
                          {t('favoriteStatus.' + (selectedCollection.profile_status || 'empty'))}
                        </span>
                        {(selectedCollection.can_apply_as_dna ?? selectedCollection.can_apply_as_taste) && (
                          <span className="type-chat-kicker text-muted-foreground">{t('favoriteDNAEnabled')}</span>
                        )}
                      </div>
                      <div className="inline-flex items-center gap-2 border border-border/70 px-2.5 py-1.5">
                        <span className="type-chat-kicker text-muted-foreground">{t('updatedAt')}</span>
                        <span className="type-chat-meta text-foreground">
                          {formatCollectionTimestamp(selectedCollection.updated_at, i18n.language)}
                        </span>
                      </div>
                      <p className="type-chat-meta text-muted-foreground xl:ml-auto">
                        {t('favoriteUploadDropHint')}
                      </p>
                    </div>
                  </div>

                  {message && (
                    <div className="shrink-0 border-b border-border/80 px-4 py-2.5 sm:px-5">
                      <p className="type-chat-meta text-muted-foreground">{message}</p>
                    </div>
                  )}

                  {(uploadJob || uploadBatchProgress) && isUploadQueueOpen && (
                    <div className="shrink-0 border-b border-border/80 px-4 py-3.5 sm:px-5 xl:px-6">
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-start">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            {(uploadBatchProgress?.status ?? uploadJob?.status) === 'completed' ? (
                              <CheckCircle2 className={cn(FAVORITE_STATUS_ICON_CLASS, 'text-foreground')} />
                            ) : (uploadBatchProgress?.status ?? uploadJob?.status) === 'partial_failed' || (uploadBatchProgress?.status ?? uploadJob?.status) === 'failed' ? (
                              <AlertTriangle className={cn(FAVORITE_STATUS_ICON_CLASS, 'text-destructive')} />
                            ) : (uploadBatchProgress?.status ?? uploadJob?.status) === 'processing' ? (
                              <Loader2 className={cn(FAVORITE_STATUS_ICON_CLASS, 'animate-spin text-muted-foreground')} />
                            ) : (
                              <Clock3 className={cn(FAVORITE_STATUS_ICON_CLASS, 'text-muted-foreground')} />
                            )}
                            <p className="type-chat-kicker text-muted-foreground">{t('favoriteUploadQueueTitle')}</p>
                          </div>
                          <p className={cn('type-chat-label', resolveUploadJobTone(uploadBatchProgress?.status ?? uploadJob?.status ?? 'pending'))}>
                            {t('favoriteUploadJobStatus.' + (uploadBatchProgress?.status ?? uploadJob?.status ?? 'pending'))}
                          </p>
                          <p className="type-chat-meta max-w-[42ch] text-muted-foreground">
                            {uploadJob?.error_message || t('favoriteUploadQueueHint')}
                          </p>
                        </div>

                        <div className="grid gap-2 border-t border-border/80 pt-3 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
                          <div className="flex items-center justify-between gap-3">
                            <span className="type-chat-meta text-muted-foreground">{t('favoriteUploadProgressLabel')}</span>
                            <span className="type-chat-kicker text-foreground">
                              {String(uploadBatchProgress?.completed_files ?? uploadJob?.completed_count ?? 0).padStart(2, '0')} / {String(uploadBatchProgress?.total_files ?? uploadJob?.total_count ?? 0).padStart(2, '0')}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="type-chat-meta text-muted-foreground">{t('favoriteUploadFailedLabel')}</span>
                            <span className="type-chat-kicker text-foreground">{String(uploadBatchProgress?.failed_files ?? uploadJob?.failed_count ?? 0).padStart(2, '0')}</span>
                          </div>
                          {uploadBatchProgress && (
                            <>
                              <div className="flex items-center justify-between gap-3">
                                <span className="type-chat-meta text-muted-foreground">{t('favoriteUploadCurrentBatchLabel')}</span>
                                <span className="type-chat-kicker text-foreground">
                                  {String(uploadBatchProgress.current_batch_index).padStart(2, '0')} / {String(uploadBatchProgress.total_batches).padStart(2, '0')}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="type-chat-meta text-muted-foreground">{t('favoriteUploadRemainingBatchesLabel')}</span>
                                <span className="type-chat-kicker text-foreground">{String(uploadBatchProgress.remaining_batches).padStart(2, '0')}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {uploadBatchProgress && (
                        <div className="mt-4 border-t border-border/60 pt-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="type-chat-meta text-muted-foreground">{t('favoriteUploadBatchLabel')}</p>
                            <p className="type-chat-kicker text-foreground">
                              {t('favoriteUploadBatchValue', {
                                current: String(uploadBatchProgress.current_batch_index).padStart(2, '0'),
                                total: String(uploadBatchProgress.total_batches).padStart(2, '0'),
                              })}
                            </p>
                          </div>
                        </div>
                      )}

                      {uploadJob && (
                        <div className="mt-4 max-h-[188px] space-y-2 overflow-y-auto pr-1">
                          {uploadJob.items.map(item => (
                            <div key={item.id} className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                              <div className="min-w-0">
                                <p className="type-chat-label truncate text-foreground">{item.filename}</p>
                                {item.error_message && (
                                  <p className="mt-1 type-chat-meta truncate text-destructive">{item.error_message}</p>
                                )}
                              </div>
                              <span className={cn('type-chat-kicker shrink-0', resolveUploadJobTone(item.status))}>
                                {t('favoriteUploadItemStatus.' + item.status)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {isLoadingDetail ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : selectedDetail && selectedDetail.items.length === 0 ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-8">
                      <div className="flex w-full max-w-[30rem] flex-col items-center text-center">
                        <ImagePlus className="size-4 text-muted-foreground" />
                        <div className="mt-6 flex w-full max-w-[25rem] flex-col items-center gap-2.5">
                          <p className="type-section-title max-w-[12ch] text-balance text-center text-foreground">
                            {t('favoriteCollectionEmptyTitle')}
                          </p>
                          <p className="type-chat-meta max-w-[31ch] text-balance text-center leading-6 text-muted-foreground">
                            {t('favoriteCollectionWorkbenchEmptyHint')}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-6 rounded-none"
                          onClick={() => uploadInputRef.current?.click()}
                          disabled={isUploading || hasActiveUploadJob}
                        >
                          <Upload className="size-4" />
                          {hasActiveUploadJob ? t('favoriteUploadInProgressLabel') : t('favoriteUploadAction')}
                        </Button>
                      </div>
                    </div>
                  ) : selectedDetail ? (
                    <>
                      <div className="shrink-0 border-b border-border/80 px-4 py-2.5 sm:px-5 xl:px-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-none"
                              onClick={handleToggleSelectionMode}
                            >
                              {isSelectionMode ? t('favoriteSelectionDone') : t('favoriteSelectionMode')}
                            </Button>
                            {isSelectionMode && (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="rounded-none"
                                  onClick={handleToggleSelectAll}
                                >
                                  {selectedImageIds.length === selectedDetail.items.length ? t('favoriteSelectionClear') : t('favoriteSelectionAll')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="rounded-none"
                                  onClick={() => setIsBulkDeleteConfirmOpen(true)}
                                  disabled={selectedImageIds.length === 0 || isSaving}
                                >
                                  <Trash2 className="size-4" />
                                  {t('favoriteSelectionDelete')}
                                </Button>
                              </>
                            )}
                          </div>
                          <p className="type-chat-meta text-muted-foreground">
                            {isSelectionMode
                              ? t('favoriteSelectionCount', { count: selectedImageIds.length })
                              : selectedDetail.has_more
                                ? selectedDetail.items.length + ' / ' + selectedDetail.item_count
                                : t('favoriteCollectionCount', { count: selectedDetail.item_count })}
                          </p>
                        </div>
                      </div>
                      {/* Keep scrolling inside the grid pane so the page frame stays still. */}
                      <div ref={detailScrollViewportRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5 sm:px-4 sm:py-4 xl:px-5">
                        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                          {selectedDetail.items.map(item => {
                            const detailHref = item.detail_image_id ? '/image/' + item.detail_image_id : item.image_url
                            const itemTitle = item.source_type === 'upload'
                              ? item.original_filename || t('favoriteUploadedReference')
                              : item.brand || t('image')
                            const isSelected = selectedImageIds.includes(item.image_id)
                            return (
                              <article
                                key={item.id}
                                className={cn(
                                  'group overflow-hidden border border-border/60 bg-background transition-colors',
                                  isSelectionMode && isSelected && 'border-foreground bg-accent/20',
                                )}
                              >
                                <div className="relative border-b border-border/60">
                                  {isSelectionMode && (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleItemSelection(item.image_id)}
                                      className={cn(
                                        'absolute left-2 top-2 z-10 flex size-8 items-center justify-center border bg-background/92 text-muted-foreground transition-colors',
                                        isSelected ? 'border-foreground text-foreground' : 'border-border/80 hover:border-foreground/50 hover:text-foreground',
                                      )}
                                      aria-label={isSelected ? t('favoriteSelectionDeselect') : t('favoriteSelectionSelect')}
                                    >
                                      {isSelected ? <Check className="size-4" /> : <span className="size-3 border border-current" />}
                                    </button>
                                  )}
                                  {isSelectionMode ? (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleItemSelection(item.image_id)}
                                      className="block w-full overflow-hidden bg-muted/20 text-left"
                                    >
                                      <img src={item.image_url} alt={itemTitle} className="aspect-[4/5] h-full w-full object-cover" loading="lazy" />
                                    </button>
                                  ) : (
                                    <a
                                      href={detailHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block overflow-hidden bg-muted/20"
                                    >
                                      <img src={item.image_url} alt={itemTitle} className="aspect-[4/5] h-full w-full object-cover transition-transform duration-normal group-hover:scale-[1.01]" loading="lazy" />
                                    </a>
                                  )}
                                </div>

                                <div className="space-y-2 px-2.5 pb-2.5 pt-2">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="type-chat-label line-clamp-1 text-foreground">{itemTitle}</p>
                                      <p className="mt-1 type-chat-meta line-clamp-1 text-muted-foreground">
                                        {item.source_type === 'upload'
                                          ? t('favoriteUploadedReferenceMeta')
                                          : buildCollectionItemMeta(item, t('favoriteCollectionItemMetaFallback'))}
                                      </p>
                                    </div>
                                    <span className="type-chat-kicker shrink-0 text-muted-foreground">
                                      {item.source_type === 'upload' ? t('favoriteSourceUpload') : t('favoriteSourceCatalog')}
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                                    <a
                                      href={detailHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={cn(
                                        FAVORITE_INLINE_ACTION_CLASS,
                                        isSelectionMode ? 'pointer-events-none text-muted-foreground/40' : 'text-muted-foreground hover:text-foreground',
                                      )}
                                    >
                                      {item.source_type === 'upload' ? t('favoriteOpenAsset') : t('view')}
                                      <ExternalLink className="size-3.5" />
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveItem(item)}
                                      className={cn(
                                        FAVORITE_INLINE_ACTION_CLASS,
                                        isSelectionMode ? 'pointer-events-none text-muted-foreground/40' : 'text-muted-foreground hover:text-foreground',
                                      )}
                                    >
                                      <Trash2 className="size-3.5" />
                                      {t('delete')}
                                    </button>
                                  </div>
                                </div>
                              </article>
                            )
                          })}
                        </div>
                        <div ref={detailLoadMoreRef} className="h-6" />
                        {(selectedDetail.has_more || isLoadingMoreDetail) && (
                          <div className="flex justify-center pb-2 pt-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-none"
                              onClick={handleLoadMoreDetail}
                              disabled={isLoadingMoreDetail || isLoadingDetail}
                            >
                              {isLoadingMoreDetail ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}
                              {isLoadingMoreDetail ? t('loading') : t('loadMore')}
                            </Button>
                          </div>
                        )}
                        {!selectedDetail.has_more && selectedDetail.items.length > 0 && (
                          <p className="pb-2 text-center type-chat-kicker text-muted-foreground">{t('allImagesLoaded')}</p>
                        )}
                      </div>
                    </>
                  ) : null}
                </>
              )}

              {selectedCollection && isDropActive && (
                <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center border border-foreground bg-background/92">
                  <div className="max-w-[24rem] space-y-3 px-6 text-center">
                    <Upload className="mx-auto size-4 text-foreground" />
                    <p className="type-section-title text-foreground">{t('favoriteUploadDropActiveTitle')}</p>
                    <p className="type-chat-meta text-muted-foreground">{t('favoriteUploadDropActiveHint')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
      </PageFrame>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-[560px] rounded-none border-border/80">
          <DialogHeader>
            <DialogTitle>{t('favoriteCollectionCreateTitle')}</DialogTitle>
            <DialogDescription>{t('favoriteCollectionCreateHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newCollectionName}
              onChange={event => setNewCollectionName(event.target.value)}
              placeholder={t('favoriteCollectionNamePlaceholder')}
              className="rounded-none"
            />
            <textarea
              value={newCollectionDescription}
              onChange={event => setNewCollectionDescription(event.target.value)}
              placeholder={t('favoriteCollectionDescriptionPlaceholder')}
              className={cn(COLLECTION_TEXTAREA_CLASS, 'min-h-[116px]')}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-none" onClick={() => setIsCreateOpen(false)}>
              {t('close')}
            </Button>
            <Button type="button" className="rounded-none" onClick={() => void handleCreateCollection()} disabled={isSaving || !newCollectionName.trim()}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t('favoriteCollectionCreateAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteCollectionConfirmOpen} onOpenChange={setIsDeleteCollectionConfirmOpen}>
        <DialogContent className="max-w-[520px] rounded-none border-border/80">
          <DialogHeader>
            <DialogTitle>{t('favoriteCollectionDeleteConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('favoriteCollectionDeleteConfirmHint', { name: selectedCollection?.name || '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-none" onClick={() => setIsDeleteCollectionConfirmOpen(false)}>
              {t('close')}
            </Button>
            <Button type="button" className="rounded-none" onClick={() => void handleDelete()} disabled={isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t('favoriteCollectionDeleteConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
        <DialogContent className="max-w-[520px] rounded-none border-border/80">
          <DialogHeader>
            <DialogTitle>{t('favoriteSelectionDeleteConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('favoriteSelectionDeleteConfirmHint', { count: selectedImageIds.length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-none" onClick={() => setIsBulkDeleteConfirmOpen(false)}>
              {t('close')}
            </Button>
            <Button
              type="button"
              className="rounded-none"
              onClick={() => void handleBulkRemoveItems()}
              disabled={isSaving || selectedImageIds.length === 0}
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t('favoriteSelectionDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
