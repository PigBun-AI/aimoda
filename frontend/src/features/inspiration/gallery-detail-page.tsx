import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'

import { PageFrame } from '@/components/layout/page-frame'
import { PageIntro } from '@/components/layout/page-intro'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { fetchGallery, fetchSimilarByColor, type Gallery, type GalleryImage } from './gallery-api'

interface GalleryEntry {
  image: GalleryImage
  index: number
}

const LIGHTBOX_CHROME_BUTTON_CLASS = 'inline-flex size-10 items-center justify-center border border-white/15 text-white/70 transition-colors hover:border-white/40 hover:text-white'
const LIGHTBOX_NAV_BUTTON_CLASS = 'absolute top-1/2 z-40 inline-flex size-10 -translate-y-1/2 items-center justify-center border border-white/12 bg-black/60 text-white/70 transition-colors hover:border-white/35 hover:text-white'

function buildGalleryMeta(gallery: Gallery, language: string) {
  return [
    {
      label: 'Category',
      value: gallery.category || 'Archive',
    },
    {
      label: 'Looks',
      value: String(gallery.image_count).padStart(2, '0'),
    },
    {
      label: 'Updated',
      value: new Date(gallery.updated_at).toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    },
  ]
}

function formatLookIndex(index: number) {
  return String(index + 1).padStart(2, '0')
}

function estimateImageHeight(image: GalleryImage) {
  const width = Number(image.width)
  const height = Number(image.height)
  if (width > 0 && height > 0) {
    return height / width
  }
  return 1.35
}

function getMasonryColumnCount(width: number) {
  if (width >= 1600) return 4
  if (width >= 1100) return 3
  if (width >= 720) return 2
  return 1
}

function distributeEntries(entries: GalleryEntry[], columnCount: number) {
  const safeColumnCount = Math.max(1, columnCount)
  const columns: GalleryEntry[][] = Array.from({ length: safeColumnCount }, () => [])
  const heights = Array.from({ length: safeColumnCount }, () => 0)

  for (const entry of entries) {
    let shortestColumnIndex = 0
    for (let index = 1; index < heights.length; index += 1) {
      if (heights[index] < heights[shortestColumnIndex]) {
        shortestColumnIndex = index
      }
    }

    columns[shortestColumnIndex].push(entry)
    heights[shortestColumnIndex] += estimateImageHeight(entry.image)
  }

  return columns
}

function formatImageDimensions(image: GalleryImage) {
  if (!image.width || !image.height) return null
  return `${image.width} × ${image.height}`
}

export function GalleryDetailPage() {
  const { t, i18n } = useTranslation('common')
  const { galleryId } = useParams<{ galleryId: string }>()
  const [gallery, setGallery] = useState<Gallery | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [searchColors, setSearchColors] = useState<{ h: number; s: number; v: number; hex: string } | null>(null)
  const [similarImages, setSimilarImages] = useState<GalleryImage[]>([])
  const [searchingColors, setSearchingColors] = useState(false)
  const [columnCount, setColumnCount] = useState(1)
  const masonryRef = useRef<HTMLDivElement | null>(null)

  const handleColorSearch = async (h: number, s: number, v: number, hex: string) => {
    setSearchColors({ h, s, v, hex })
    setSearchingColors(true)
    try {
      const res = await fetchSimilarByColor({ h, s, v, limit: 30 })
      setSimilarImages(res.images)
    } catch (err) {
      console.error(err)
    } finally {
      setSearchingColors(false)
    }
  }

  useEffect(() => {
    if (!galleryId) return
    setLoading(true)
    fetchGallery(galleryId)
      .then(setGallery)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [galleryId])

  useEffect(() => {
    const host = masonryRef.current
    if (!host) return

    const updateColumnCount = () => {
      setColumnCount(getMasonryColumnCount(host.clientWidth))
    }

    updateColumnCount()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(updateColumnCount)
    observer.observe(host)
    return () => observer.disconnect()
  }, [gallery?.id, gallery?.images?.length])

  const images = gallery?.images || []
  const entries = useMemo(
    () => images.map((image, index) => ({ image, index })),
    [images],
  )
  const masonryColumns = useMemo(
    () => distributeEntries(entries, columnCount),
    [entries, columnCount],
  )
  const galleryMeta = gallery ? buildGalleryMeta(gallery, i18n.language) : []
  const activeImage = lightboxIndex !== null ? images[lightboxIndex] : null

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (lightboxIndex === null) return
      if (e.key === 'ArrowLeft' && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1)
      else if (e.key === 'ArrowRight' && lightboxIndex < images.length - 1) setLightboxIndex(lightboxIndex + 1)
      else if (e.key === 'Escape') setLightboxIndex(null)
    },
    [lightboxIndex, images.length],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (loading) {
    return (
      <section className="space-y-6">
        <Skeleton className="h-10 w-32 rounded-none" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-[42rem] w-full rounded-none" />
          <Skeleton className="h-[32rem] w-full rounded-none" />
        </div>
      </section>
    )
  }

  if (!gallery) {
    return (
      <section className="flex flex-col items-center justify-center py-20">
        <p className="type-page-title max-w-[10ch] text-center text-foreground">{t('galleryNotFound')}</p>
        <Link to="/inspiration" className="mt-6">
          <Button variant="outline" size="sm" className="rounded-none">
            <ArrowLeft className="mr-1 size-4" />
            {t('backToInspiration')}
          </Button>
        </Link>
      </section>
    )
  }

  return (
    <PageFrame width="full">
      <section className="mx-auto w-full max-w-[1600px]">
        <div className="border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <Link to="/inspiration">
              <Button variant="ghost" size="sm" className="gap-1 rounded-none px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                <ArrowLeft className="size-4" />
                {t('backToInspiration')}
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <span className="type-chat-kicker text-muted-foreground">{gallery.category || t('imageArchiveLabel')}</span>
              <span className="size-1 bg-foreground/70" />
              <span className="type-chat-kicker text-foreground">{String(gallery.image_count).padStart(2, '0')}</span>
            </div>
          </div>

          <div className="pt-4 sm:pt-5">
            <PageIntro
              variant="editorial"
              eyebrow="Inspiration dossier"
              title={gallery.title}
              description={gallery.description || 'Curated visual references'}
              titleClassName="max-w-[11ch]"
              descriptionClassName="max-w-[46ch]"
              aside={(
                <div className="flex h-full flex-col justify-between gap-4">
                  <div className="space-y-3">
                    {galleryMeta.map((item) => (
                      <div key={item.label} className="flex items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
                        <span className="type-chat-kicker text-muted-foreground">{item.label}</span>
                        <span className="type-chat-meta text-right text-foreground">{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="type-meta flex items-center justify-between border-t border-border/60 pt-3 text-muted-foreground">
                    <span>Gallery flow</span>
                    <span className="tabular-nums text-foreground">{String(images.length).padStart(2, '0')}</span>
                  </div>
                </div>
              )}
            />
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_304px] xl:items-start">
          <div className="order-2 xl:order-1">
          <div className="border-b border-border pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="type-chat-kicker text-muted-foreground">Gallery flow</p>
                <p className="type-chat-meta mt-1 text-muted-foreground">
                  Original proportions preserved. Tap any image for focused viewing.
                </p>
              </div>
              <div className="type-chat-kicker text-muted-foreground">
                {String(images.length).padStart(2, '0')} looks
              </div>
            </div>
          </div>

          <div
            ref={masonryRef}
            className="mt-5 grid gap-3.5 md:gap-4"
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
          >
            {masonryColumns.map((column, columnIndex) => (
              <div key={`column-${columnIndex}`} className="flex min-w-0 flex-col gap-3.5 md:gap-4">
                {column.map(({ image, index }) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setLightboxIndex(index)}
                    className="group block w-full text-left"
                  >
                    <div className="border border-border bg-card p-3">
                      <div className="overflow-hidden bg-white dark:bg-black">
                        <img
                          src={image.image_url}
                          alt={image.caption || `${gallery.title} ${formatLookIndex(index)}`}
                          className="block w-full h-auto transition-transform duration-500 group-hover:scale-[1.01]"
                          loading={index < columnCount * 2 ? 'eager' : 'lazy'}
                        />
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-4 border-t border-border pt-3">
                        <div className="min-w-0 space-y-1">
                          <p className="type-chat-kicker text-muted-foreground">
                            {formatLookIndex(index)}
                          </p>
                          <p className="type-chat-meta truncate text-foreground/88">
                            {image.caption || gallery.title}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="type-chat-meta text-muted-foreground">
                            {formatImageDimensions(image) || gallery.category || 'Archive'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <aside className="order-1 xl:order-2 xl:sticky xl:top-20">
          <div className="space-y-4">
            <div className="border border-border bg-card p-4 sm:p-5">
              <p className="type-chat-kicker text-muted-foreground">Overview</p>
              <div className="mt-4 space-y-3">
                {galleryMeta.map((item) => (
                  <div key={item.label} className="flex items-start justify-between gap-4 border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <span className="type-chat-kicker text-muted-foreground">{item.label}</span>
                    <span className="type-chat-meta text-right text-foreground">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-border bg-card p-4 sm:p-5">
              <p className="type-chat-kicker text-muted-foreground">Tags</p>
              {gallery.tags.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {gallery.tags.map((tag) => (
                    <span
                      key={tag}
                      className="type-chat-kicker border border-border px-2.5 py-1 text-foreground/82"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="type-chat-meta mt-4 text-muted-foreground">No editorial tags for this selection.</p>
              )}
            </div>

            {images[0] && (
              <div className="border border-border bg-card p-4">
                <p className="type-chat-kicker text-muted-foreground">First frame</p>
                <button
                  type="button"
                  onClick={() => setLightboxIndex(0)}
                  className="mt-4 block w-full border border-border bg-white p-3 transition-colors hover:border-foreground/40 dark:bg-black"
                >
                  <img
                    src={images[0].image_url}
                    alt={images[0].caption || gallery.title}
                    className="block w-full h-auto"
                    loading="eager"
                  />
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="flex justify-center pb-2 pt-10">
        <Link to="/inspiration">
          <Button variant="outline" size="sm" className="gap-1 rounded-none">
            <ArrowLeft className="size-4" />
            {t('backToInspiration')}
          </Button>
        </Link>
      </div>
      </section>

      {lightboxIndex !== null && activeImage && (
        <div
          className="fixed inset-0 z-50 bg-black text-white"
          onClick={() => setLightboxIndex(null)}
        >
          <div className="flex h-full flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 border-b border-white/12 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="type-chat-kicker text-white/45">{gallery.category || 'Archive'}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <span className="type-chat-kicker truncate text-white">{gallery.title}</span>
                  <span className="size-1 bg-white/35" />
                  <span className="type-chat-kicker text-white">{formatLookIndex(lightboxIndex)} / {String(images.length).padStart(2, '0')}</span>
                </div>
              </div>
              <button
                type="button"
                className={LIGHTBOX_CHROME_BUTTON_CLASS}
                onClick={() => setLightboxIndex(null)}
                aria-label={t('close')}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_304px]">
              <div className="relative flex min-h-0 items-center justify-center px-4 py-4 sm:px-6 sm:py-5">
                {lightboxIndex > 0 && (
                  <button
                    type="button"
                    className={`${LIGHTBOX_NAV_BUTTON_CLASS} left-3 sm:left-6`}
                    onClick={() => setLightboxIndex(lightboxIndex - 1)}
                    aria-label={t('previous')}
                  >
                    <ChevronLeft className="size-6" />
                  </button>
                )}

                <img
                  src={activeImage.image_url}
                  alt={activeImage.caption || gallery.title}
                  className="max-h-[calc(100dvh-13.5rem)] max-w-full object-contain"
                />

                {lightboxIndex < images.length - 1 && (
                  <button
                    type="button"
                    className={`${LIGHTBOX_NAV_BUTTON_CLASS} right-3 sm:right-6`}
                    onClick={() => setLightboxIndex(lightboxIndex + 1)}
                    aria-label={t('next')}
                  >
                    <ChevronRight className="size-6" />
                  </button>
                )}
              </div>

              <aside className="min-h-0 overflow-y-auto border-t border-white/10 px-4 py-4 sm:px-5 xl:border-l xl:border-t-0">
                <div className="space-y-5">
                  <div className="border-b border-white/12 pb-4">
                    <p className="type-chat-kicker text-white/45">Caption</p>
                    <p className="type-chat-kicker mt-3 text-white">
                      {activeImage.caption || gallery.title}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <p className="type-chat-kicker text-white/45">Details</p>
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <span className="type-chat-kicker text-white/45">Look</span>
                        <span className="type-chat-kicker text-white">{formatLookIndex(lightboxIndex)}</span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="type-chat-kicker text-white/45">Gallery</span>
                        <span className="type-chat-kicker text-right text-white">{gallery.title}</span>
                      </div>
                      {formatImageDimensions(activeImage) && (
                        <div className="flex items-start justify-between gap-4">
                          <span className="type-chat-kicker text-white/45">Format</span>
                          <span className="type-chat-kicker text-white">{formatImageDimensions(activeImage)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {activeImage.colors && activeImage.colors.length > 0 && (
                    <div className="border-t border-white/12 pt-4">
                      <p className="type-chat-kicker text-white/45">Color tracking</p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        {activeImage.colors.map((color, index) => (
                          <button
                            key={`${color.hex}-${index}`}
                            type="button"
                            onClick={() => handleColorSearch(color.hsv.h, color.hsv.s, color.hsv.v, color.hex)}
                            className="size-9 border border-white/20 transition-transform hover:scale-110 hover:border-white"
                            style={{ backgroundColor: color.hex }}
                            title={`HSV: ${color.hsv.h},${color.hsv.s},${color.hsv.v} (${color.percentage}%)`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            </div>

            <div className="border-t border-white/10 px-4 py-3 sm:px-5">
              <div className="flex gap-3 overflow-x-auto pb-1">
                {images.map((image, index) => {
                  const isActive = index === lightboxIndex
                  return (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setLightboxIndex(index)}
                      className={`group shrink-0 border p-2 transition-colors ${isActive ? 'border-white bg-white/6' : 'border-white/12 hover:border-white/35'}`}
                    >
                      <div className="flex w-20 items-center justify-center bg-white/4 sm:w-24" style={{ aspectRatio: '5 / 6' }}>
                        <img
                          src={image.image_url}
                          alt={image.caption || `${gallery.title} ${formatLookIndex(index)}`}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="mt-2 text-left">
                        <p className="type-chat-kicker text-white/45">
                          {formatLookIndex(index)}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {searchColors && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
          <div className="sticky top-0 z-40 border-b border-border bg-background px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="size-6 border border-border"
                  style={{ backgroundColor: searchColors.hex }}
                />
                <div className="min-w-0">
                  <h2 className="type-section-title text-foreground">{t('globalColorTracking')}</h2>
                  <span className="type-chat-kicker block text-muted-foreground">
                    {searchingColors ? t('searching') : t('searchResultCount', { count: similarImages.length })}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="rounded-none" onClick={() => setSearchColors(null)}>
                <X className="size-5" />
              </Button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-5 md:p-6">
            {searchingColors ? (
              <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="mb-3 h-56 w-full rounded-none sm:mb-4 sm:h-72" />
                ))}
              </div>
            ) : similarImages.length > 0 ? (
              <div className="columns-1 gap-3 [column-fill:_balance] sm:columns-2 lg:columns-3 xl:columns-4">
                {similarImages.map((image) => (
                  <div key={image.id} className="group mb-3 break-inside-avoid sm:mb-4">
                    <div className="relative overflow-hidden border border-border bg-card p-3">
                      <img
                        src={image.image_url}
                        alt=""
                        className="block w-full h-auto transition-transform duration-500 group-hover:scale-[1.015]"
                        loading="lazy"
                      />
                      {image.similarity_score !== undefined && (
                        <div className="type-chat-kicker absolute right-5 top-5 z-40 flex items-center gap-1.5 border border-border bg-background px-2 py-1 text-foreground">
                          {image.matched_color?.hex && (
                            <div className="size-2.5" style={{ backgroundColor: image.matched_color.hex }} />
                          )}
                          {image.similarity_score}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
                <div className="size-12 border border-border" style={{ backgroundColor: searchColors.hex }} />
                {t('noStyleWithColor')}
              </div>
            )}
          </div>
        </div>
      )}
    </PageFrame>
  )
}
