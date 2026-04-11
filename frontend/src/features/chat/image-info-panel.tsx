import { ArrowUpRight, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ImageResult, ExtractedColor } from "./chat-types"
import type { DetailSearchTarget } from "./image-detail-search"

function formatBrand(brand: string): string {
  if (!brand) return ""
  return brand
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function formatLocationInfo(image: ImageResult, t: (key: string) => string): string {
  const parts: string[] = []
  if (image.year) parts.push(String(image.year))
  if (image.quarter) {
    parts.push(String(image.quarter))
  } else if (image.season) {
    const seasonMap: Record<string, string> = {
      spring: t("seasonSpringSummer"),
      summer: t("seasonSpringSummer"),
      fall: t("seasonFallWinter"),
      winter: t("seasonFallWinter"),
      "spring-summer": t("seasonSpringSummer"),
      "fall-winter": t("seasonFallWinter"),
      resort: t("seasonResort"),
      "pre-fall": t("seasonPreFall"),
      cruise: t("seasonResort"),
    }
    const s = typeof image.season === "string" ? image.season.toLowerCase() : ""
    parts.push(seasonMap[s] || String(image.season))
  }
  return parts.join(" / ")
}

function getDescriptionText(image: ImageResult): string {
  return image.style || ""
}

function getReadableTextColor(hex: string) {
  const normalized = hex.replace("#", "")
  const expanded = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized

  if (expanded.length !== 6) {
    return {
      primary: "rgba(0,0,0,0.82)",
      secondary: "rgba(0,0,0,0.62)",
    }
  }

  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const isDark = luminance < 0.54

  return isDark
    ? { primary: "rgba(255,255,255,0.92)", secondary: "rgba(255,255,255,0.72)" }
    : { primary: "rgba(0,0,0,0.82)", secondary: "rgba(0,0,0,0.62)" }
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
  const { t } = useTranslation("common")
  const extractedColors = image.extracted_colors || []
  const locationInfo = formatLocationInfo(image, t)
  const descriptionText = getDescriptionText(image)
  const brandSearchKey = image.brand?.toLowerCase() ?? ""
  const isSearchingBrand = activeSearchTarget?.type === "brand" && activeSearchTarget.key === brandSearchKey
  const isSearchingColor = activeSearchTarget?.type === "color"

  return (
    <div className="h-full w-full shrink-0 overflow-y-auto bg-transparent p-5 sm:p-6" style={{ overflowX: "visible" }}>
      <div className="space-y-8">
        {(image.brand || locationInfo || descriptionText) && (
          <section className="space-y-4 border-b border-border pb-6">
            <p className="type-chat-kicker text-muted-foreground">aimoda</p>
            {image.brand && (
              <button
                type="button"
                className={`group inline-flex max-w-full items-start gap-3 text-left ${isSearchingBrand ? "pointer-events-none opacity-60" : ""}`}
                onClick={() => void onBrandSearch?.(image.brand)}
                title={t("searchBrandImages")}
              >
                <span className="min-w-0">
                  <span className="type-ed-title-sm block truncate text-foreground transition-colors group-hover:text-muted-foreground">
                    {formatBrand(image.brand)}
                  </span>
                  <span className="type-chat-kicker mt-2 inline-flex items-center gap-1 border border-border px-2 py-1 text-muted-foreground transition-colors group-hover:border-foreground/30 group-hover:bg-accent/20 group-hover:text-foreground">
                    {t("searchAction")}
                    {isSearchingBrand ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUpRight className="h-3 w-3" />}
                  </span>
                </span>
              </button>
            )}
            {locationInfo && <p className="type-chat-meta text-muted-foreground">{locationInfo}</p>}
            {descriptionText && <p className="type-chat-body max-w-[28ch] text-muted-foreground">{descriptionText}</p>}
          </section>
        )}

        {extractedColors.length > 0 && (
          <section className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <p className="type-chat-kicker text-muted-foreground">{t("keyColors")}</p>
              <span className="type-chat-kicker text-muted-foreground">{t("searchAction")}</span>
            </div>

            <div className="relative">
              <div className={`flex flex-col border border-border ${isSearchingColor ? "pointer-events-none opacity-50" : ""}`}>
                {extractedColors.slice(0, 8).map((color, index) => {
                  const minHeight = 24
                  const maxHeight = 78
                  const height = Math.max(minHeight, Math.min(maxHeight, color.percentage * 1.45))
                  const textColor = getReadableTextColor(color.hex)

                  return (
                    <button
                      key={index}
                      type="button"
                      className="flex w-full items-center justify-between border-b border-black/10 px-3 py-2 text-left transition-opacity last:border-b-0 hover:opacity-92"
                      style={{ backgroundColor: color.hex, minHeight: `${height}px` }}
                      title={t("searchColorSwatch", { color: color.color_name, hex: color.hex, percentage: color.percentage })}
                      onClick={() => void onColorSearch?.(color)}
                    >
                      <span className="min-w-0">
                        <span className="type-chat-kicker block truncate" style={{ color: textColor.primary }}>
                          {color.color_name}
                        </span>
                        <span className="type-chat-kicker mt-1 inline-flex items-center gap-1" style={{ color: textColor.secondary }}>
                          {t("searchAction")}
                          <ArrowUpRight className="h-3 w-3" />
                        </span>
                      </span>
                      <span className="type-chat-kicker" style={{ color: textColor.secondary }}>
                        {color.hex}
                      </span>
                    </button>
                  )
                })}
              </div>

              {isSearchingColor && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/88">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
