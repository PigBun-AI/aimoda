import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Languages, Moon, Sun, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useTheme } from '@/components/theme-toggle'

import { getImageListContext } from './image-context'
import { ImageInfoPanel } from './image-info-panel'
import { ImageViewer } from './image-viewer'
import { ImageActionBar } from './image-action-bar'
import { SearchResultsGrid } from './search-results-grid'
import { fetchImageDetail } from './chat-api'
import { useImageDetailSearch } from './image-detail-search'
import type { ImageResult, ExtractedColor } from './chat-types'

function formatBrand(brand: string) {
  if (!brand) return ''
  return brand
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatSeasonLabel(image: ImageResult, t: (key: string) => string) {
  const parts: string[] = []

  if (image.year) parts.push(String(image.year))

  if (image.quarter) {
    parts.push(String(image.quarter))
  } else if (image.season) {
    const seasonMap: Record<string, string> = {
      spring: t('seasonSpringSummer'),
      summer: t('seasonSpringSummer'),
      fall: t('seasonFallWinter'),
      winter: t('seasonFallWinter'),
      'spring-summer': t('seasonSpringSummer'),
      'fall-winter': t('seasonFallWinter'),
      resort: t('seasonResort'),
      'pre-fall': t('seasonPreFall'),
      cruise: t('seasonResort'),
    }
    const normalized = typeof image.season === 'string' ? image.season.toLowerCase() : ''
    parts.push(seasonMap[normalized] || String(image.season))
  }

  return parts.join(' / ')
}

export function ImageDetailPage() {
  const { t, i18n } = useTranslation('common')
  const { theme, toggleTheme } = useTheme()
  const { imageId } = useParams<{ imageId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const contextId = searchParams.get('contextId')
  const searchResultsRef = useRef<HTMLDivElement>(null)

  const [fetchedImage, setFetchedImage] = useState<ImageResult | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  const context = useMemo(() => {
    if (!contextId) return null
    return getImageListContext(contextId)
  }, [contextId])

  const images = context?.images ?? []

  const currentIndex = useMemo(() => {
    if (!imageId) return -1
    return images.findIndex(img => img.image_id === imageId)
  }, [images, imageId])

  useEffect(() => {
    if (context || !imageId) return

    setIsFetching(true)
    fetchImageDetail(imageId)
      .then(data => setFetchedImage(data))
      .catch(err => console.error('Failed to fetch image detail:', err))
      .finally(() => setIsFetching(false))
  }, [imageId, context])

  const currentImage = currentIndex >= 0 ? images[currentIndex] : fetchedImage
  const hasMultiple = images.length > 1
  const {
    searchResults,
    searchLabel,
    isSearchLoading,
    activeSearchTarget,
    searchByBrand,
    searchByPalette,
    searchByLabel,
    changePage,
    resetSearch,
  } = useImageDetailSearch(searchResultsRef)

  useEffect(() => {
    resetSearch()
  }, [currentImage?.image_id, resetSearch])

  const goPrev = useCallback(() => {
    if (currentIndex <= 0) return
    const prev = images[currentIndex - 1]
    navigate(`/image/${prev.image_id}${contextId ? `?contextId=${contextId}` : ''}`, { replace: true })
  }, [contextId, currentIndex, images, navigate])

  const goNext = useCallback(() => {
    if (currentIndex >= images.length - 1) return
    const next = images[currentIndex + 1]
    navigate(`/image/${next.image_id}${contextId ? `?contextId=${contextId}` : ''}`, { replace: true })
  }, [contextId, currentIndex, images, navigate])

  const handleClose = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    window.close()
  }, [navigate])

  const handleBrandSearch = useCallback(async (brand: string) => {
    await searchByBrand(brand, t('brandSearchLabel', { brand: formatBrand(brand) }))
  }, [searchByBrand, t])

  const handleColorSearch = useCallback(async (color: ExtractedColor) => {
    await searchByPalette(
      color.hex,
      color.color_name,
      currentImage?.gender,
      `${color.color_name} (${color.hex})`,
    )
  }, [currentImage?.gender, searchByPalette])

  const handleLabelSearch = useCallback(async (
    label: { name: string; category: string; topCategory: string },
  ) => {
    if (!currentImage) return
    await searchByLabel({
      ...label,
      imageId: currentImage.image_id,
      gender: currentImage.gender,
    })
  }, [currentImage, searchByLabel])

  const isLoading = !currentImage && (isFetching || context !== null)
  const titleBrand = currentImage?.brand ? formatBrand(currentImage.brand) : t('image')
  const imageMeta = currentImage ? formatSeasonLabel(currentImage, t) : ''
  const currentLanguageLabel = i18n.language === 'zh-CN' ? 'EN' : '中'
  const toggleLanguage = useCallback(() => {
    const nextLanguage = i18n.language === 'zh-CN' ? 'en' : 'zh-CN'
    void i18n.changeLanguage(nextLanguage)
    localStorage.setItem('i18nextLng', nextLanguage)
  }, [i18n])

  return (
    <div className="min-h-screen bg-background">
      <header data-image-detail-header="true" className="sticky top-0 z-30 border-b border-border bg-background/92 backdrop-blur-md">
        <div className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link to="/" className="shrink-0 transition-opacity hover:opacity-70">
              <img src="/aimoda-logo.svg" alt="aimoda" className="h-[20px] w-auto dark:hidden" />
              <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden h-[20px] w-auto dark:block" />
            </Link>

            <div className="hidden min-w-0 border-l border-border pl-4 sm:block">
              <div className="flex min-w-0 items-center gap-3">
                <h1 className="type-chat-title truncate text-foreground">
                  {titleBrand}
                </h1>
                {imageMeta && (
                  <span className="type-chat-kicker truncate text-muted-foreground">
                    {imageMeta}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              aria-label={theme === 'dark' ? t('switchLight') : t('switchDark')}
              title={theme === 'dark' ? t('switchLight') : t('switchDark')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              type="button"
              onClick={toggleLanguage}
              className="type-chat-action control-pill-sm flex min-w-[56px] items-center justify-center gap-1 border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              aria-label={i18n.language === 'zh-CN' ? t('switchToEn') : t('switchToZh')}
              title={i18n.language === 'zh-CN' ? t('switchToEn') : t('switchToZh')}
            >
              <Languages size={14} />
              <span>{currentLanguageLabel}</span>
            </button>
            {hasMultiple && currentIndex > 0 && (
              <button
                onClick={goPrev}
                className="control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                aria-label={t('previousImage')}
              >
                <ChevronLeft size={16} />
              </button>
            )}
            {hasMultiple && (
              <div className="type-chat-kicker control-pill-sm hidden min-w-[82px] items-center justify-center border border-border text-muted-foreground sm:flex">
                {currentIndex + 1} / {images.length}
              </div>
            )}
            {hasMultiple && currentIndex < images.length - 1 && (
              <button
                onClick={goNext}
                className="control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                aria-label={t('nextImage')}
              >
                <ChevronRight size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="control-icon-sm flex items-center justify-center border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              aria-label={t('close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center px-4 py-10" style={{ minHeight: 'calc(100vh - 64px)' }}>
          <div className="flex min-w-[240px] max-w-full flex-col items-center gap-4 border border-border px-8 py-10">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-pulse bg-muted-foreground" style={{ animationDelay: '0s' }} />
              <span className="h-1.5 w-1.5 animate-pulse bg-muted-foreground" style={{ animationDelay: '0.2s' }} />
              <span className="h-1.5 w-1.5 animate-pulse bg-muted-foreground" style={{ animationDelay: '0.4s' }} />
            </div>
            <p className="type-chat-kicker text-muted-foreground">
              {t('loadingImageDetails')}
            </p>
          </div>
        </div>
      )}

      {currentImage && (
        <div className="w-full px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5 xl:px-6 xl:py-6">
          <section
            className="overflow-hidden border border-border/80 bg-background lg:h-[calc(100dvh-64px-40px)] xl:h-[calc(100dvh-64px-48px)]"
          >
            <div className="flex min-h-0 flex-col lg:grid lg:h-full lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_88px]">
              <div className="order-3 min-h-0 border-t border-border lg:order-1 lg:border-r lg:border-t-0 xl:border-b-0">
                <ImageInfoPanel
                  image={currentImage}
                  activeSearchTarget={activeSearchTarget}
                  onBrandSearch={handleBrandSearch}
                  onColorSearch={handleColorSearch}
                />
              </div>

              <div className="order-1 relative min-h-0 border-b border-border bg-background lg:order-2 lg:border-b-0">
                <ImageViewer
                  image={currentImage}
                  activeLabelKey={activeSearchTarget?.type === 'label' ? activeSearchTarget.key : null}
                  onLabelSearch={handleLabelSearch}
                />
              </div>

              <div className="order-2 min-h-0 border-b border-border bg-background lg:order-3 lg:col-span-2 lg:border-b-0 lg:border-t xl:col-span-1 xl:border-l xl:border-t-0">
                <ImageActionBar image={currentImage} />
              </div>
            </div>
          </section>

          {searchResults && (
            <div ref={searchResultsRef} className="mt-8">
              <SearchResultsGrid
                searchResults={searchResults}
                labelName={searchLabel}
                onPageChange={changePage}
                isLoading={isSearchLoading}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
