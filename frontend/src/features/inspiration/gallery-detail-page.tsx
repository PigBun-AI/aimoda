import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { fetchGallery, fetchSimilarByColor, type Gallery, type GalleryImage } from './gallery-api'

export function GalleryDetailPage() {
  const { t } = useTranslation('common')
  const { galleryId } = useParams<{ galleryId: string }>()
  const [gallery, setGallery] = useState<Gallery | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [searchColors, setSearchColors] = useState<{h:number, s:number, v:number, hex: string} | null>(null)
  const [similarImages, setSimilarImages] = useState<GalleryImage[]>([])
  const [searchingColors, setSearchingColors] = useState(false)

  const handleColorSearch = async (h: number, s: number, v: number, hex: string) => {
    setSearchColors({h,s,v,hex})
    setSearchingColors(true)
    try {
      const res = await fetchSimilarByColor({h,s,v, limit: 30})
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

  const images = gallery?.images || []

  // Keyboard navigation
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
      <section className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="aspect-[3/4] w-full rounded-[var(--radius)]" />
      </section>
    )
  }

  if (!gallery) {
    return (
      <section className="flex flex-col items-center justify-center py-20">
        <p className="font-serif text-3xl tracking-[-0.03em] text-foreground">{t('galleryNotFound')}</p>
        <Link to="/inspiration" className="mt-4">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('backToInspiration')}
          </Button>
        </Link>
      </section>
    )
  }

  // Split remaining images into pairs for 2-column editorial layout
  const remainingImages = images.slice(1)

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 md:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Link to="/inspiration">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            {t('back')}
          </Button>
        </Link>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {gallery.image_count} LOOKS
        </span>
      </div>

      <header className="mb-8 space-y-4">
        <div className="space-y-4">
          <h1 className="font-serif text-3xl font-medium tracking-[-0.04em] text-foreground sm:text-4xl lg:text-5xl">
            {gallery.title}
          </h1>
          {gallery.description && (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {gallery.description}
            </p>
          )}
          {gallery.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {gallery.tags.map((tag) => (
                <span
                  key={tag}
                  className="border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {images.length > 0 && (
        <div
          className="group mb-3 cursor-pointer sm:mb-4"
          onClick={() => setLightboxIndex(0)}
        >
          <div className="overflow-hidden border border-border bg-muted">
            <img
              src={images[0].image_url}
              alt={gallery.title}
              className="w-full h-auto transition-transform duration-700 group-hover:scale-[1.02]"
            />
          </div>
        </div>
      )}

      <div className="columns-1 gap-2 [column-fill:_balance] md:columns-2 md:gap-4">
        {remainingImages.map((img, idx) => (
          <div
            key={img.id}
            className="break-inside-avoid mb-2 sm:mb-4 cursor-pointer group"
            onClick={() => setLightboxIndex(idx + 1)}
          >
            <div className="overflow-hidden border border-border bg-muted">
              <img
                src={img.image_url}
                alt={img.caption || `Look ${idx + 2}`}
                className="w-full h-auto transition-transform duration-500 group-hover:scale-[1.02]"
                loading="lazy"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-center pb-6 pt-10">
        <Link to="/inspiration">
          <Button variant="outline" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            {t('backToInspiration')}
          </Button>
        </Link>
      </div>

      {/* ── Lightbox ── */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            className="absolute right-3 top-3 z-10 border border-white/12 p-2 text-white/40 transition-colors hover:border-white/30 hover:text-white sm:right-4 sm:top-4"
            onClick={() => setLightboxIndex(null)}
          >
            <X className="h-6 w-6" />
          </button>

          {lightboxIndex > 0 && (
            <button
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 text-white/30 transition-colors hover:text-white sm:left-4"
              onClick={(e) => {
                e.stopPropagation()
                setLightboxIndex(lightboxIndex - 1)
              }}
            >
              <ChevronLeft className="h-8 w-8 sm:h-10 sm:w-10" />
            </button>
          )}

          {lightboxIndex < images.length - 1 && (
            <button
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-white/30 transition-colors hover:text-white sm:right-4"
              onClick={(e) => {
                e.stopPropagation()
                setLightboxIndex(lightboxIndex + 1)
              }}
            >
              <ChevronRight className="h-8 w-8 sm:h-10 sm:w-10" />
            </button>
          )}

          <div
            className="max-h-[92vh] max-w-[92vw] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={images[lightboxIndex].image_url}
              alt={images[lightboxIndex].caption || ''}
              className="max-h-[88vh] max-w-full object-contain"
            />
            <span className="mt-2 text-[11px] text-white/30 font-mono tracking-widest">
              {lightboxIndex + 1} / {images.length}
            </span>

            {/* Colors Palette in Lightbox */}
          {images[lightboxIndex].colors && images[lightboxIndex].colors.length > 0 && (
              <div
                className="mt-6 flex max-w-full flex-wrap justify-center gap-3 border border-white/10 bg-white/5 p-3 backdrop-blur-md"
                onClick={(e) => e.stopPropagation()}
              >
                {images[lightboxIndex].colors!.map((c, i) => (
                  <button
                    key={i}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      handleColorSearch(c.hsv.h, c.hsv.s, c.hsv.v, c.hex)
                    }}
                    className="h-8 w-8 border border-white/20 transition-transform hover:scale-125 focus:outline-none focus:border-white"
                    style={{ backgroundColor: c.hex }}
                    title={`HSV: ${c.hsv.h},${c.hsv.s},${c.hsv.v} (${c.percentage}%)`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Search Results Overlay ── */}
      {searchColors && (
        <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-background/95 backdrop-blur-sm">
          <div className="sticky top-0 z-10 border-b border-border bg-background/80 p-4 backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="h-6 w-6 border border-border"
                  style={{ backgroundColor: searchColors.hex }}
                />
                <div className="min-w-0">
                  <h2 className="font-serif text-xl tracking-[-0.03em] text-foreground">{t('globalColorTracking')}</h2>
                  <span className="block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {searchingColors ? t('searching') : t('searchResultCount', { count: similarImages.length })}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSearchColors(null)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 md:p-8">
            {searchingColors ? (
              <div className="columns-1 gap-2 sm:columns-2 sm:gap-4 lg:columns-3 xl:columns-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <Skeleton key={i} className="mb-2 h-48 w-full rounded-sm sm:mb-4 sm:h-64" />
                ))}
              </div>
            ) : similarImages.length > 0 ? (
              <div className="columns-1 gap-2 [column-fill:_balance] sm:columns-2 sm:gap-4 lg:columns-3 xl:columns-4">
                {similarImages.map((img) => (
                  <div key={img.id} className="break-inside-avoid mb-2 sm:mb-4 group">
                    <div className="relative overflow-hidden border border-border bg-muted">
                      <img 
                        src={img.image_url} 
                        alt="" 
                        className="w-full h-auto transition-transform duration-500 group-hover:scale-[1.02]" 
                        loading="lazy" 
                      />
                      {img.similarity_score !== undefined && (
                        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 border border-border bg-background/80 px-2 py-0.5 font-mono text-[10px] text-foreground backdrop-blur">
                          {img.matched_color?.hex && (
                            <div className="h-2.5 w-2.5" style={{ backgroundColor: img.matched_color.hex }} />
                          )}
                          {img.similarity_score}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-20 text-center text-muted-foreground flex flex-col items-center gap-3">
                <div className="h-12 w-12 border border-border" style={{ backgroundColor: searchColors.hex }} />
                {t('noStyleWithColor')}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
