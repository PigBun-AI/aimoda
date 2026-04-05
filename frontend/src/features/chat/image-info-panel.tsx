import { ArrowUpRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ImageResult, ExtractedColor } from './chat-types'
import type { DetailSearchTarget } from './image-detail-search'

function formatBrand(brand: string): string {
  if (!brand) return ''
  return brand
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

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
  return parts.join(' / ')
}

function categorizeColors(colors: ExtractedColor[]) {
  const mainColors: ExtractedColor[] = []
  const accentColors: ExtractedColor[] = []
  const textureColors: ExtractedColor[] = []

  colors.forEach(color => {
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

function getReadableTextColor(hex: string) {
  const normalized = hex.replace('#', '')
  const expanded = normalized.length === 3
    ? normalized.split('').map(char => char + char).join('')
    : normalized

  if (expanded.length !== 6) {
    return {
      primary: 'rgba(0,0,0,0.82)',
      secondary: 'rgba(0,0,0,0.62)',
    }
  }

  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const isDark = luminance < 0.54

  return isDark
    ? { primary: 'rgba(255,255,255,0.92)', secondary: 'rgba(255,255,255,0.72)' }
    : { primary: 'rgba(0,0,0,0.82)', secondary: 'rgba(0,0,0,0.62)' }
}

interface ImageInfoPanelProps {
  image: ImageResult
  activeSearchTarget?: DetailSearchTarget
  onBrandSearch?: (brand: string) => void | Promise<void>
  onColorSearch?: (color: ExtractedColor) => void | Promise<void>
}

export function ImageInfoPanel({
  image,
  activeSearchTarget = null,
  onBrandSearch,
  onColorSearch,
}: ImageInfoPanelProps) {
  const { t } = useTranslation('common')
  const extractedColors = image.extracted_colors || []
  const locationInfo = formatLocationInfo(image, t)
  const descriptionText = getDescriptionText(image)
  const { mainColors, accentColors, textureColors } = categorizeColors(extractedColors)
  const brandSearchKey = image.brand?.toLowerCase() ?? ''
  const isSearchingBrand = activeSearchTarget?.type === 'brand' && activeSearchTarget.key === brandSearchKey
  const isSearchingColor = activeSearchTarget?.type === 'color'

  return (
    <div className="h-full w-full shrink-0 overflow-y-auto bg-transparent p-5 sm:p-6" style={{ overflowX: 'visible' }}>
      <div className="space-y-8">
        {(image.brand || locationInfo || descriptionText) && (
          <section className="space-y-4 border-b border-border pb-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              aimoda
            </p>
            {image.brand && (
              <button
                type="button"
                className={`group inline-flex max-w-full items-start gap-3 text-left ${isSearchingBrand ? 'pointer-events-none opacity-60' : ''}`}
                onClick={() => void onBrandSearch?.(image.brand)}
                title={t('searchBrandImages')}
              >
                <span className="min-w-0">
                  <span className="type-editorial-inline block truncate text-foreground transition-colors group-hover:text-muted-foreground">
                    {formatBrand(image.brand)}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 border border-border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors group-hover:border-foreground/30 group-hover:text-foreground">
                    {t('searchAction')}
                    {isSearchingBrand ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUpRight className="h-3 w-3" />}
                  </span>
                </span>
              </button>
            )}
            {locationInfo && (
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {locationInfo}
              </p>
            )}
            {descriptionText && (
              <p className="max-w-[28ch] text-sm leading-6 text-muted-foreground">
                {descriptionText}
              </p>
            )}
          </section>
        )}

        {extractedColors.length > 0 && (
          <section className="space-y-5 border-b border-border pb-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t('keyColors')}
              </p>
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('searchAction')}
              </span>
            </div>

            <div className="relative">
              <div className={`flex flex-col border border-border ${isSearchingColor ? 'pointer-events-none opacity-50' : ''}`}>
                {extractedColors.slice(0, 6).map((color, index) => {
                  const minHeight = 24
                  const maxHeight = 78
                  const height = Math.max(minHeight, Math.min(maxHeight, color.percentage * 1.45))
                  const textColor = getReadableTextColor(color.hex)

                  return (
                    <button
                      key={index}
                      type="button"
                      className="flex w-full items-center justify-between border-b border-black/10 px-3 py-2 text-left transition-opacity last:border-b-0 hover:opacity-90"
                      style={{ backgroundColor: color.hex, minHeight: `${height}px` }}
                      title={t('searchColorSwatch', { color: color.color_name, hex: color.hex, percentage: color.percentage })}
                      onClick={() => void onColorSearch?.(color)}
                    >
                      <span className="min-w-0">
                        <span
                          className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em]"
                          style={{ color: textColor.primary }}
                        >
                          {color.color_name}
                        </span>
                        <span
                          className="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em]"
                          style={{ color: textColor.secondary }}
                        >
                          {t('searchAction')}
                          <ArrowUpRight className="h-3 w-3" />
                        </span>
                      </span>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                        style={{ color: textColor.secondary }}
                      >
                        {color.hex}
                      </span>
                    </button>
                  )
                })}
              </div>

              {isSearchingColor && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </section>
        )}

        <section className="space-y-5">
          {mainColors.length > 0 && (
            <ColorGroup
              title={t('mainColors')}
              colors={mainColors}
              onColorSearch={onColorSearch}
              isSearchingColor={isSearchingColor}
              t={t}
            />
          )}

          {accentColors.length > 0 && (
            <ColorGroup
              title={t('accentColors')}
              colors={accentColors}
              onColorSearch={onColorSearch}
              isSearchingColor={isSearchingColor}
              t={t}
            />
          )}

          {textureColors.length > 0 && (
            <ColorGroup
              title={t('textureColors')}
              colors={textureColors}
              onColorSearch={onColorSearch}
              isSearchingColor={isSearchingColor}
              t={t}
            />
          )}
        </section>
      </div>
    </div>
  )
}

interface ColorGroupProps {
  title: string
  colors: ExtractedColor[]
  onColorSearch?: (color: ExtractedColor) => void | Promise<void>
  isSearchingColor: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}

function ColorGroup({ title, colors, onColorSearch, isSearchingColor, t }: ColorGroupProps) {
  return (
    <div className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
      <div className="space-y-2">
        {colors.map((color, index) => (
          <button
            key={index}
            type="button"
            className={`group flex w-full items-center justify-between gap-3 border border-border px-3 py-2 text-left transition-colors hover:border-foreground/45 hover:text-foreground ${isSearchingColor ? 'pointer-events-none opacity-60' : ''}`}
            onClick={() => void onColorSearch?.(color)}
            title={t('searchColor', { color: color.color_name })}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="h-3 w-3 shrink-0 border border-black/10" style={{ backgroundColor: color.hex }} />
              <span className="min-w-0">
                <span className="block truncate text-[11px] uppercase tracking-[0.14em] text-foreground">
                  {color.color_name}
                </span>
                <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors group-hover:text-foreground">
                  {t('searchAction')}
                  <ArrowUpRight className="h-3 w-3" />
                </span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {color.hex}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
