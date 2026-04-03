import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageResult, ExtractedColor } from './chat-types'
import type { SearchResponse } from './chat-api'
import { searchSimilar, searchByColor } from './chat-api'

/** Format brand name: capitalize each word */
function formatBrand(brand: string): string {
  if (!brand) return ''
  return brand
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Format season display */
function formatLocationInfo(image: ImageResult, t: (key: string) => string): string {
  const parts: string[] = []
  if (image.year) parts.push(String(image.year))
  if (image.season) {
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
    const s = typeof image.season === 'string' ? image.season.toLowerCase() : ''
    parts.push(seasonMap[s] || String(image.season))
  }
  if (image.quarter) parts.push(String(image.quarter))
  return parts.join('')
}

/** Categorize colors by percentage thresholds */
function categorizeColors(colors: ExtractedColor[]) {
  const mainColors: ExtractedColor[] = []
  const accentColors: ExtractedColor[] = []
  const textureColors: ExtractedColor[] = []

  colors.forEach((color) => {
    if (color.percentage >= 20) {
      mainColors.push(color)
    } else if (color.percentage >= 5) {
      accentColors.push(color)
    } else {
      textureColors.push(color)
    }
  })

  return { mainColors, accentColors, textureColors }
}

function getDescriptionText(image: ImageResult): string {
  return image.style || ''
}

interface ImageInfoPanelProps {
  image: ImageResult
  onSearchResult?: (results: SearchResponse, labelName: string, searchType?: string, params?: any) => void
}

export function ImageInfoPanel({ image, onSearchResult }: ImageInfoPanelProps) {
  const { t } = useTranslation('common')
  const extractedColors = image.extracted_colors || []
  const locationInfo = formatLocationInfo(image, t)
  const descriptionText = getDescriptionText(image)
  const { mainColors, accentColors, textureColors } = categorizeColors(extractedColors)

  const [isSearchingBrand, setIsSearchingBrand] = useState(false)
  const [isSearchingColor, setIsSearchingColor] = useState(false)

  /** Brand click → search by brand */
  const handleBrandSearch = async (brand: string) => {
    if (isSearchingBrand) return
    setIsSearchingBrand(true)
    try {
      const params = { brand, page: 1, page_size: 56 }
      const results = await searchSimilar(params)
      onSearchResult?.(results, t('brandSearchLabel', { brand: formatBrand(brand) }), 'similar', params)
    } catch (err) {
      console.error('Brand search failed:', err)
    } finally {
      setIsSearchingBrand(false)
    }
  }

  /** Color click → search by color hex */
  const handleColorSearch = async (color: ExtractedColor) => {
    if (isSearchingColor) return
    setIsSearchingColor(true)
    try {
      const params = {
        hex: color.hex,
        color_name: color.color_name,
        gender: image.gender,
        page: 1,
        page_size: 56,
      }
      const results = await searchByColor(params)
      onSearchResult?.(results, `${color.color_name} (${color.hex})`, 'color', params)
    } catch (err) {
      console.error('Color search failed:', err)
    } finally {
      setIsSearchingColor(false)
    }
  }

  return (
    <div
      className="w-full lg:w-[320px] shrink-0 bg-transparent p-4 sm:p-6 overflow-y-auto lg:h-[calc(100vh-56px)]"
      style={{ overflowX: 'visible' }}
    >
      {/* Brand and location */}
      {(image.brand || locationInfo) && (
        <div className="mb-8">
          {image.brand && (
            <div
              className={`font-bold text-foreground mb-2.5 text-2xl leading-none cursor-pointer hover:text-blue-600 transition-colors inline-flex items-center gap-2 ${isSearchingBrand ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={() => handleBrandSearch(image.brand)}
              title={t('searchBrandImages')}
            >
              {formatBrand(image.brand)}
              {isSearchingBrand && (
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              )}
            </div>
          )}
          {locationInfo && (
            <p className="text-sm text-foreground">{locationInfo}</p>
          )}
        </div>
      )}

      {/* Key colors title */}
      <h3 className="text-2xl font-medium text-foreground mb-7">
        {t('keyColors')}
      </h3>

      {/* Description text */}
      {descriptionText && (
        <p className="text-xs text-foreground font-bold mb-6 leading-relaxed">
          {descriptionText}
        </p>
      )}

      {/* Color swatches — clickable for search */}
      {extractedColors.length > 0 && (
        <div className="relative mb-6">
          <div className={`flex flex-col w-15 ${isSearchingColor ? 'opacity-50 pointer-events-none' : ''}`}>
            {extractedColors.slice(0, 6).map((color, index) => {
              const minHeight = 20
              const maxHeight = 80
              const height = Math.max(
                minHeight,
                Math.min(maxHeight, color.percentage * 1.5),
              )

              return (
                <div
                  key={index}
                  className="w-full shrink-0 transition-all cursor-pointer hover:opacity-80 hover:z-10 hover:scale-x-110 origin-left"
                  style={{
                    height: `${height}px`,
                    backgroundColor: color.hex,
                  }}
                  title={t('searchColorSwatch', { color: color.color_name, hex: color.hex, percentage: color.percentage })}
                  onClick={() => handleColorSearch(color)}
                />
              )
            })}
          </div>
          {isSearchingColor && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            </div>
          )}
        </div>
      )}

      {/* Color categories — clickable */}
      <div className="space-y-3">
        {mainColors.length > 0 && (
          <div>
            <div className="text-sm font-bold text-foreground mb-2">{t('mainColors')}</div>
            <div className="space-y-1">
              {mainColors.map((color, index) => (
                <div
                  key={index}
                  className="text-xs text-foreground font-bold cursor-pointer hover:text-primary transition-colors"
                  onClick={() => handleColorSearch(color)}
                  title={t('searchColor', { color: color.color_name })}
                >
                  {color.hex} ({color.color_name})
                </div>
              ))}
            </div>
          </div>
        )}

        {accentColors.length > 0 && (
          <div>
            <div className="text-sm font-bold text-foreground mb-2">{t('accentColors')}</div>
            <div className="space-y-1">
              {accentColors.map((color, index) => (
                <div
                  key={index}
                  className="text-xs text-foreground font-bold cursor-pointer hover:text-primary transition-colors"
                  onClick={() => handleColorSearch(color)}
                  title={t('searchColor', { color: color.color_name })}
                >
                  {color.hex} ({color.color_name})
                </div>
              ))}
            </div>
          </div>
        )}

        {textureColors.length > 0 && (
          <div>
            <div className="text-sm font-bold text-foreground mb-2">{t('textureColors')}</div>
            <div className="space-y-1">
              {textureColors.map((color, index) => (
                <div
                  key={index}
                  className="text-xs text-foreground font-bold cursor-pointer hover:text-primary transition-colors"
                  onClick={() => handleColorSearch(color)}
                  title={t('searchColor', { color: color.color_name })}
                >
                  {color.hex} ({color.color_name})
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
