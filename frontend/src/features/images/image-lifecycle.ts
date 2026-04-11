import { useSyncExternalStore } from 'react'

import { removeImageFromAllContexts } from '@/features/chat/image-context'

export const CATALOG_IMAGE_DELETED_EVENT = 'fashion-report:catalog-image-deleted'

export interface CatalogImageDeletedDetail {
  imageId: string
  imageUrl?: string
  brand?: string
  affectedSearchRequestIds: string[]
  affectedFavoriteCollectionIds: string[]
  removedCollectionCount?: number
  deletedAt: number
}

const storeListeners = new Set<() => void>()
const eventListeners = new Set<(detail: CatalogImageDeletedDetail) => void>()
const deletedImages = new Map<string, CatalogImageDeletedDetail>()
const deletedImageIdsBySearchRequestId = new Map<string, Set<string>>()
const deletedImageIdsByFavoriteCollectionId = new Map<string, Set<string>>()

let lifecycleVersion = 0

function normalizeUniqueIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(
    values
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  ))
}

function indexDeletedImage(map: Map<string, Set<string>>, ownerId: string, imageId: string) {
  const normalizedOwnerId = ownerId.trim()
  if (!normalizedOwnerId) return

  const existing = map.get(normalizedOwnerId)
  if (existing?.has(imageId)) return

  const next = new Set(existing ?? [])
  next.add(imageId)
  map.set(normalizedOwnerId, next)
}

function notify(detail: CatalogImageDeletedDetail) {
  lifecycleVersion += 1
  for (const listener of storeListeners) listener()
  for (const listener of eventListeners) listener(detail)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<CatalogImageDeletedDetail>(CATALOG_IMAGE_DELETED_EVENT, { detail }))
  }
}

function areSameStringArrays(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function registerDeletedCatalogImage(
  detail: Omit<CatalogImageDeletedDetail, 'deletedAt'> & { deletedAt?: number },
): CatalogImageDeletedDetail | null {
  const imageId = detail.imageId.trim()
  if (!imageId) return null

  const previous = deletedImages.get(imageId)
  const nextDetail: CatalogImageDeletedDetail = {
    imageId,
    imageUrl: detail.imageUrl ?? previous?.imageUrl,
    brand: detail.brand ?? previous?.brand,
    affectedSearchRequestIds: normalizeUniqueIds([
      ...(previous?.affectedSearchRequestIds ?? []),
      ...detail.affectedSearchRequestIds,
    ]),
    affectedFavoriteCollectionIds: normalizeUniqueIds([
      ...(previous?.affectedFavoriteCollectionIds ?? []),
      ...detail.affectedFavoriteCollectionIds,
    ]),
    removedCollectionCount: detail.removedCollectionCount ?? previous?.removedCollectionCount,
    deletedAt: detail.deletedAt ?? previous?.deletedAt ?? Date.now(),
  }

  if (
    previous
    && previous.imageUrl === nextDetail.imageUrl
    && previous.brand === nextDetail.brand
    && previous.removedCollectionCount === nextDetail.removedCollectionCount
    && areSameStringArrays(previous.affectedSearchRequestIds, nextDetail.affectedSearchRequestIds)
    && areSameStringArrays(previous.affectedFavoriteCollectionIds, nextDetail.affectedFavoriteCollectionIds)
  ) {
    return previous
  }

  deletedImages.set(imageId, nextDetail)
  removeImageFromAllContexts(imageId)

  for (const searchRequestId of nextDetail.affectedSearchRequestIds) {
    indexDeletedImage(deletedImageIdsBySearchRequestId, searchRequestId, imageId)
  }
  for (const collectionId of nextDetail.affectedFavoriteCollectionIds) {
    indexDeletedImage(deletedImageIdsByFavoriteCollectionId, collectionId, imageId)
  }

  notify(nextDetail)
  return nextDetail
}

export function subscribeToCatalogImageDeleted(listener: (detail: CatalogImageDeletedDetail) => void) {
  eventListeners.add(listener)
  return () => {
    eventListeners.delete(listener)
  }
}

export function subscribeToImageLifecycle(listener: () => void) {
  storeListeners.add(listener)
  return () => {
    storeListeners.delete(listener)
  }
}

export function useCatalogImageLifecycleVersion() {
  return useSyncExternalStore(subscribeToImageLifecycle, () => lifecycleVersion, () => 0)
}

export function getDeletedCatalogImage(imageId: string) {
  return deletedImages.get(imageId.trim()) ?? null
}

export function isCatalogImageDeleted(imageId: string) {
  return deletedImages.has(imageId.trim())
}

export function getDeletedImageIdsForSearchRequest(searchRequestId: string) {
  return Array.from(deletedImageIdsBySearchRequestId.get(searchRequestId.trim()) ?? [])
}

export function getDeletedImageIdsForFavoriteCollection(collectionId: string) {
  return Array.from(deletedImageIdsByFavoriteCollectionId.get(collectionId.trim()) ?? [])
}
