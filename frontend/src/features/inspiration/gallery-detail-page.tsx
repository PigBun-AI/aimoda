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
        <Skeleton className="aspect-[3/4] w-full rounded-xl" />
      </section>
    )
  }

  if (!gallery) {
    return (
      <section className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">{t('galleryNotFound')}</p>
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
    <section className="px-4 sm:px-6 md:px-8 py-6 sm:py-8 max-w-5xl mx-auto">
      {/* ── Title bar ── */}
      <div className="flex items-center justify-between mb-4">
        <Link to="/inspiration">
          <Button variant="ghost" size="sm" className="gap-1 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {t('back')}
          </Button>
        </Link>
        <span className="text-xs text-muted-foreground font-mono">
          {gallery.image_count} LOOKS
        </span>
      </div>

      {/* ── Gallery title section ── */}
      <header className="mb-6 sm:mb-8">
        <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-light tracking-tight text-foreground">
          {gallery.title}
        </h1>
        {gallery.description && (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-3xl">
            {gallery.description}
          </p>
        )}
        {gallery.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {gallery.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border border-border text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* ── Hero: First image full-width ── */}
      {images.length > 0 && (
        <div
          className="cursor-pointer group mb-2 sm:mb-4"
          onClick={() => setLightboxIndex(0)}
        >
          <div className="overflow-hidden rounded-sm bg-muted">
            <img
              src={images[0].image_url}
              alt={gallery.title}
              className="w-full h-auto transition-transform duration-700 group-hover:scale-[1.02]"
            />
          </div>
        </div>
      )}

      {/* ── Remaining images: 2-column masonry on desktop, 1 on mobile ── */}
      <div className="columns-1 sm:columns-2 gap-2 sm:gap-4 [column-fill:_balance]">
        {remainingImages.map((img, idx) => (
          <div
            key={img.id}
            className="break-inside-avoid mb-2 sm:mb-4 cursor-pointer group"
            onClick={() => setLightboxIndex(idx + 1)}
          >
            <div className="overflow-hidden rounded-sm bg-muted">
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

      {/* ── Bottom nav ── */}
      <div className="pt-10 pb-6 flex justify-center">
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
            className="absolute top-4 right-4 text-white/40 hover:text-white z-10 transition-colors"
            onClick={() => setLightboxIndex(null)}
          >
            <X className="h-6 w-6" />
          </button>

          {lightboxIndex > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white z-10 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                setLightboxIndex(lightboxIndex - 1)
              }}
            >
              <ChevronLeft className="h-10 w-10" />
            </button>
          )}

          {lightboxIndex < images.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white z-10 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                setLightboxIndex(lightboxIndex + 1)
              }}
            >
              <ChevronRight className="h-10 w-10" />
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
                className="mt-6 flex gap-3 p-3 rounded-full bg-white/5 backdrop-blur-md border border-white/10"
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
                    className="w-8 h-8 rounded-full border-2 border-white/20 shadow-lg transition-transform hover:scale-125 focus:outline-none focus:border-white"
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
        <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm overflow-y-auto flex flex-col">
          <div className="sticky top-0 bg-background/80 backdrop-blur border-b border-border p-4 flex items-center justify-between z-10">
            <div className="flex items-center gap-3">
              <div 
                className="w-6 h-6 rounded-full border border-border shadow-sm" 
                style={{ backgroundColor: searchColors.hex }} 
              />
              <h2 className="font-medium text-foreground">{t('globalColorTracking')}</h2>
              <span className="text-muted-foreground text-sm ml-2">
                {searchingColors ? t('searching') : t('searchResultCount', { count: similarImages.length })}
              </span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSearchColors(null)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          
          <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full">
            {searchingColors ? (
              <div className="columns-2 sm:columns-3 md:columns-4 gap-2 sm:gap-4">
                {[1,2,3,4,5,6,7,8].map((i) => (
                  <Skeleton key={i} className="mb-2 sm:mb-4 w-full h-48 sm:h-64 rounded-sm" />
                ))}
              </div>
            ) : similarImages.length > 0 ? (
              <div className="columns-2 sm:columns-3 md:columns-4 gap-2 sm:gap-4 [column-fill:_balance]">
                {similarImages.map((img) => (
                  <div key={img.id} className="break-inside-avoid mb-2 sm:mb-4 group">
                    <div className="overflow-hidden rounded-sm bg-muted relative">
                      <img 
                        src={img.image_url} 
                        alt="" 
                        className="w-full h-auto transition-transform duration-500 group-hover:scale-[1.02]" 
                        loading="lazy" 
                      />
                      {img.similarity_score !== undefined && (
                        <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-background/80 backdrop-blur border border-border text-foreground text-[10px] px-2 py-0.5 rounded-full shadow-sm font-mono z-10">
                          {img.matched_color?.hex && (
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: img.matched_color.hex }} />
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
                <div className="w-12 h-12 rounded-full border-4 border-muted" style={{ backgroundColor: searchColors.hex }} />
                {t('noStyleWithColor')}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
