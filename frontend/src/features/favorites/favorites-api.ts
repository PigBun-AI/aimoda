import { handleUnauthorizedSession } from '@/lib/api'

const authTokenStorageKey = 'fashion-report-access-token'
const UPLOAD_CONCURRENCY = 3
const MAX_UPLOAD_FILES_PER_JOB = 40

function getToken(): string | null {
  return window.localStorage.getItem(authTokenStorageKey)
}

function authHeaders(contentType: 'json' | 'none' = 'json'): Record<string, string> {
  const headers: Record<string, string> = {}
  if (contentType === 'json') {
    headers['Content-Type'] = 'application/json'
  }
  const token = getToken()
  if (token) {
    headers.Authorization = 'Bearer ' + token
  }
  return headers
}

function handle401(response: Response) {
  if (response.status === 401) {
    handleUnauthorizedSession()
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    handle401(response)
    const payload = await response.json().catch(() => null) as {
      error?: string
      detail?: string | Array<{ msg?: string }>
    } | null
    const detail = Array.isArray(payload?.detail)
      ? payload?.detail.map(item => item?.msg).filter(Boolean).join(' · ')
      : payload?.detail
    throw new Error(payload?.error ?? detail ?? ('HTTP ' + response.status))
  }
  const payload = await response.json() as { data?: T }
  return payload.data as T
}

export interface FavoritePreviewItem {
  image_id: string
  image_url: string
  brand?: string
  year?: number | null
  quarter?: string | null
  season?: string | null
}

export interface FavoriteCollectionItem {
  id: string
  collection_id: string
  image_id: string
  image_url: string
  storage_path?: string | null
  source_type: 'catalog' | 'upload' | string
  source_ref_id?: string | null
  original_filename?: string | null
  mime_type?: string | null
  embedding_vector_type?: string | null
  brand: string
  year?: number | null
  quarter?: string | null
  season?: string | null
  gender?: string | null
  detail_image_id?: string | null
  added_at?: string | null
  updated_at?: string | null
}

export interface FavoriteCollection {
  id: string
  user_id: number
  name: string
  description: string
  cover_image_id?: string | null
  cover_image_url?: string | null
  profile_status: 'empty' | 'ready' | 'unavailable' | string
  profile_vector_type: string
  item_count: number
  created_at?: string | null
  updated_at?: string | null
  can_apply_as_dna?: boolean
  can_apply_as_taste?: boolean
  preview_items?: FavoritePreviewItem[]
}

export interface FavoriteCollectionDetail extends FavoriteCollection {
  items: FavoriteCollectionItem[]
  offset: number
  limit: number
  has_more: boolean
}

export interface FavoriteCollectionUploadTarget {
  method: 'PUT'
  url: string
  headers: Record<string, string>
  object_key: string
  content_type: string
}

export interface FavoriteCollectionUploadItem {
  id: string
  job_id: string
  collection_id: string
  filename: string
  content_type: string
  file_size_bytes: number
  object_key: string
  status: 'pending' | 'uploaded' | 'upload_failed' | 'processing' | 'completed' | 'failed' | string
  sort_order: number
  error_message?: string | null
  favorite_item_image_id?: string | null
  created_at: string
  updated_at: string
  started_at?: string | null
  completed_at?: string | null
  upload?: FavoriteCollectionUploadTarget
}

export interface FavoriteCollectionUploadJob {
  id: string
  collection_id: string
  user_id: number
  status: 'pending' | 'uploading' | 'queued' | 'processing' | 'completed' | 'partial_failed' | 'failed' | string
  total_count: number
  pending_count: number
  uploaded_count: number
  processing_count: number
  completed_count: number
  failed_count: number
  error_message?: string | null
  created_at: string
  updated_at: string
  started_at?: string | null
  completed_at?: string | null
  items: FavoriteCollectionUploadItem[]
}

export interface FavoriteCollectionUploadBatchProgress {
  total_files: number
  total_batches: number
  current_batch_index: number
  current_batch_size: number
  remaining_batches: number
  completed_files: number
  failed_files: number
  active_job: FavoriteCollectionUploadJob
  status: FavoriteCollectionUploadJob['status']
}

export interface AddFavoriteItemPayload {
  image_id: string
  image_url: string
  brand?: string
  year?: number | null
  quarter?: string | null
  season?: string | null
  gender?: string | null
}

export interface PrepareFavoriteUploadFilePayload {
  filename: string
  content_type: string
  file_size_bytes: number
}

export interface StartFavoriteCollectionUploadOptions {
  concurrency?: number
  onUpdate?: (job: FavoriteCollectionUploadJob) => void
  onBatchUpdate?: (progress: FavoriteCollectionUploadBatchProgress) => void
}

function chunkFiles(files: File[], size: number): File[][] {
  if (files.length <= size) return [files]

  const chunks: File[][] = []
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size))
  }
  return chunks
}

async function uploadFileToOss(file: File, target: FavoriteCollectionUploadTarget) {
  const response = await fetch(target.url, {
    method: target.method,
    headers: target.headers,
    body: file,
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || ('OSS upload failed: ' + response.status))
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      await worker(items[currentIndex], currentIndex)
    }
  })
  await Promise.all(workers)
}

export async function listFavoriteCollections(): Promise<FavoriteCollection[]> {
  const response = await fetch('/api/favorites/collections', {
    headers: authHeaders(),
  })
  return unwrap<FavoriteCollection[]>(response)
}

export async function lookupFavoriteCollections(imageId: string): Promise<FavoriteCollection[]> {
  const response = await fetch('/api/favorites/collections/lookup?image_id=' + encodeURIComponent(imageId), {
    headers: authHeaders(),
  })
  return unwrap<FavoriteCollection[]>(response)
}

export async function getFavoriteCollection(collectionId: string, offset = 0, limit = 48): Promise<FavoriteCollectionDetail> {
  const response = await fetch('/api/favorites/collections/' + collectionId + '?offset=' + offset + '&limit=' + limit, {
    headers: authHeaders(),
  })
  return unwrap<FavoriteCollectionDetail>(response)
}

export async function getActiveFavoriteCollectionUploadJob(collectionId: string): Promise<FavoriteCollectionUploadJob | null> {
  const response = await fetch('/api/favorites/collections/' + collectionId + '/upload-jobs/active', {
    headers: authHeaders(),
  })
  return unwrap<FavoriteCollectionUploadJob | null>(response)
}

export async function getFavoriteCollectionUploadJob(jobId: string): Promise<FavoriteCollectionUploadJob> {
  const response = await fetch('/api/favorites/upload-jobs/' + jobId, {
    headers: authHeaders(),
  })
  return unwrap<FavoriteCollectionUploadJob>(response)
}

export async function createFavoriteCollection(payload: { name: string; description?: string }): Promise<FavoriteCollection> {
  const response = await fetch('/api/favorites/collections', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      name: payload.name,
      description: payload.description ?? '',
    }),
  })
  return unwrap<FavoriteCollection>(response)
}

export async function updateFavoriteCollection(
  collectionId: string,
  payload: { name?: string; description?: string },
): Promise<FavoriteCollection> {
  const response = await fetch('/api/favorites/collections/' + collectionId, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return unwrap<FavoriteCollection>(response)
}

export async function deleteFavoriteCollection(collectionId: string): Promise<void> {
  const response = await fetch('/api/favorites/collections/' + collectionId, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  await unwrap<{ deleted: boolean }>(response)
}

export async function addImageToFavoriteCollection(
  collectionId: string,
  payload: AddFavoriteItemPayload,
): Promise<FavoriteCollectionDetail> {
  const response = await fetch('/api/favorites/collections/' + collectionId + '/items', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  return unwrap<FavoriteCollectionDetail>(response)
}

export async function prepareFavoriteCollectionUploadJob(
  collectionId: string,
  files: PrepareFavoriteUploadFilePayload[],
): Promise<FavoriteCollectionUploadJob> {
  const response = await fetch('/api/favorites/collections/' + collectionId + '/upload-jobs/prepare', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ files }),
  })
  return unwrap<FavoriteCollectionUploadJob>(response)
}

export async function markFavoriteCollectionUploadItemUploaded(
  jobId: string,
  itemId: string,
  objectKey?: string,
): Promise<FavoriteCollectionUploadJob> {
  const response = await fetch('/api/favorites/upload-jobs/' + jobId + '/items/' + itemId + '/uploaded', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ object_key: objectKey ?? null }),
  })
  return unwrap<FavoriteCollectionUploadJob>(response)
}

export async function markFavoriteCollectionUploadItemFailed(
  jobId: string,
  itemId: string,
  errorMessage: string,
): Promise<FavoriteCollectionUploadJob> {
  const response = await fetch('/api/favorites/upload-jobs/' + jobId + '/items/' + itemId + '/failed', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ error_message: errorMessage }),
  })
  return unwrap<FavoriteCollectionUploadJob>(response)
}

export async function completeFavoriteCollectionUploadJob(jobId: string): Promise<FavoriteCollectionUploadJob> {
  const response = await fetch('/api/favorites/upload-jobs/' + jobId + '/complete', {
    method: 'POST',
    headers: authHeaders('none'),
  })
  return unwrap<FavoriteCollectionUploadJob>(response)
}

async function startFavoriteCollectionUploadJob(
  collectionId: string,
  files: File[],
  options: StartFavoriteCollectionUploadOptions = {},
): Promise<FavoriteCollectionUploadJob> {
  const prepared = await prepareFavoriteCollectionUploadJob(
    collectionId,
    files.map(file => ({
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      file_size_bytes: file.size,
    })),
  )

  let latestJob = prepared
  options.onUpdate?.(latestJob)

  const uploadPairs = prepared.items
    .map((item, index) => ({ item, file: files[index] }))
    .filter((pair): pair is { item: FavoriteCollectionUploadItem & { upload: FavoriteCollectionUploadTarget }; file: File } => Boolean(pair.file && pair.item.upload))

  await runWithConcurrency(uploadPairs, options.concurrency ?? UPLOAD_CONCURRENCY, async ({ item, file }) => {
    try {
      await uploadFileToOss(file, item.upload)
      latestJob = await markFavoriteCollectionUploadItemUploaded(latestJob.id, item.id, item.object_key)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      latestJob = await markFavoriteCollectionUploadItemFailed(latestJob.id, item.id, message)
    }
    options.onUpdate?.(latestJob)
  })

  latestJob = await completeFavoriteCollectionUploadJob(latestJob.id)
  options.onUpdate?.(latestJob)
  return latestJob
}

function buildBatchProgress(
  chunks: File[][],
  currentBatchIndex: number,
  activeJob: FavoriteCollectionUploadJob,
  completedFilesBeforeCurrentBatch: number,
  failedFilesBeforeCurrentBatch: number,
): FavoriteCollectionUploadBatchProgress {
  const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  return {
    total_files: totalFiles,
    total_batches: chunks.length,
    current_batch_index: currentBatchIndex + 1,
    current_batch_size: chunks[currentBatchIndex]?.length ?? 0,
    remaining_batches: Math.max(0, chunks.length - currentBatchIndex - 1),
    completed_files: completedFilesBeforeCurrentBatch + activeJob.completed_count,
    failed_files: failedFilesBeforeCurrentBatch + activeJob.failed_count,
    active_job: activeJob,
    status: activeJob.status,
  }
}

export async function startFavoriteCollectionUploadBatch(
  collectionId: string,
  files: File[],
  options: StartFavoriteCollectionUploadOptions = {},
): Promise<FavoriteCollectionUploadJob> {
  const chunks = chunkFiles(files, MAX_UPLOAD_FILES_PER_JOB)
  let latestJob: FavoriteCollectionUploadJob | null = null
  let completedFiles = 0
  let failedFiles = 0

  for (const [currentBatchIndex, chunk] of chunks.entries()) {
    latestJob = await startFavoriteCollectionUploadJob(collectionId, chunk, {
      ...options,
      onUpdate: (job) => {
        options.onUpdate?.(job)
        options.onBatchUpdate?.(
          buildBatchProgress(
            chunks,
            currentBatchIndex,
            job,
            completedFiles,
            failedFiles,
          ),
        )
      },
    })

    completedFiles += latestJob.completed_count
    failedFiles += latestJob.failed_count
    if (latestJob.status === 'failed') {
      break
    }
  }

  if (!latestJob) {
    throw new Error('No files uploaded')
  }
  return latestJob
}

export async function uploadImagesToFavoriteCollection(
  collectionId: string,
  files: File[],
): Promise<FavoriteCollectionDetail> {
  let lastDetail: FavoriteCollectionDetail | null = null

  for (const file of files) {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/favorites/collections/' + collectionId + '/uploads', {
      method: 'POST',
      headers: authHeaders('none'),
      body: formData,
    })
    lastDetail = await unwrap<FavoriteCollectionDetail>(response)
  }

  if (!lastDetail) {
    throw new Error('No files uploaded')
  }
  return lastDetail
}

export async function removeImageFromFavoriteCollection(
  collectionId: string,
  imageId: string,
): Promise<FavoriteCollectionDetail> {
  const response = await fetch('/api/favorites/collections/' + collectionId + '/items/' + encodeURIComponent(imageId), {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return unwrap<FavoriteCollectionDetail>(response)
}

export async function removeImagesFromFavoriteCollection(
  collectionId: string,
  imageIds: string[],
): Promise<FavoriteCollectionDetail> {
  const normalizedIds = imageIds.map(id => id.trim()).filter(Boolean)
  const response = await fetch('/api/favorites/collections/' + collectionId + '/items/bulk-delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ image_ids: normalizedIds }),
  })
  return unwrap<FavoriteCollectionDetail>(response)
}
