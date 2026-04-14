import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { getSessionUser } from '@/features/auth/protected-route'
import { useLoginDialog } from '@/features/auth/auth-store'
import { decorativeAssets, getCoverImageSources, heroAsset, type CoverAsset } from '@/features/cover/cover-assets'

function useDesktopDecorations() {
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const media = window.matchMedia('(min-width: 768px)')
    let timeoutId: number | null = null

    const update = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }

      if (!media.matches) {
        setShouldRender(false)
        return
      }

      timeoutId = window.setTimeout(() => setShouldRender(true), 220)
    }

    update()
    media.addEventListener('change', update)
    return () => {
      media.removeEventListener('change', update)
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  return shouldRender
}

function DecorativeImage({ asset }: { asset: CoverAsset }) {
  const { webpSrc, fallbackSrc, srcSet } = getCoverImageSources(asset.filename, asset.preferredWidth, [asset.preferredWidth, asset.preferredWidth * 2])

  return (
    <div
      className={`absolute z-dropdown hidden animate-cover-slide-up md:block ${asset.className}`}
      style={{ animationDelay: asset.delay }}
    >
      <picture>
        <source srcSet={srcSet ?? webpSrc} sizes={asset.sizes} type="image/webp" />
        <img
          src={fallbackSrc}
          alt={asset.alt}
          width={asset.width}
          height={asset.height}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          className="w-full h-auto hover:scale-105 transition-transform duration-slow shadow-lg"
        />
      </picture>
    </div>
  )
}

export function CoverPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { openLogin } = useLoginDialog()
  const currentUser = getSessionUser()
  const showDecorations = useDesktopDecorations()
  const heroImage = getCoverImageSources(heroAsset.filename, heroAsset.preferredWidth, [800, 1200])

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <div className="absolute left-1/2 top-1/2 z-sticky -translate-x-1/2 -translate-y-1/2 animate-cover-scale">
        <picture>
          <source srcSet={heroImage.srcSet ?? heroImage.webpSrc} sizes={heroAsset.sizes} type="image/webp" />
          <img
            src={heroImage.fallbackSrc}
            alt={heroAsset.alt}
            width={heroAsset.width}
            height={heroAsset.height}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="h-auto w-full max-w-[960px]"
          />
        </picture>
        <div className="absolute inset-0 bg-black/34" />
      </div>

      {showDecorations ? decorativeAssets.map((asset) => <DecorativeImage key={asset.alt} asset={asset} />) : null}

      <div className="absolute left-1/2 top-1/2 z-overlay flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center px-4">
        <h1 className="type-page-title max-w-[18ch] px-6 text-center text-white animate-cover-slide-up drop-shadow-lg md:px-0" style={{ animationDelay: '0.5s' }}>
          {t('globalOneStopAI')}
        </h1>
        <p className="type-chat-kicker mt-6 max-w-[24ch] text-center text-white/72 animate-cover-slide-up drop-shadow-md" style={{ animationDelay: '0.7s' }}>
          Aimoda Intelligence
        </p>
        <p className="type-chat-body mb-4 mt-4 max-w-[28ch] text-center text-white/88 animate-cover-slide-up drop-shadow-md" style={{ animationDelay: '0.9s' }}>
          {t('searchDesignMarketing')}
        </p>
        <div className="animate-cover-slide-up" style={{ animationDelay: '1.1s' }}>
          <Button
            variant="ghostGlass"
            className="mt-8 h-11 w-auto px-6 text-white border-white/20 bg-white/8 hover:border-white/35 hover:bg-white/14 hover:text-white"
            onClick={() => {
              if (!currentUser) {
                openLogin()
                return
              }
              navigate('/chat')
            }}
          >
            {t('startNow')}
            <ArrowRight className="ml-1 size-4" />
          </Button>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 z-dropdown -translate-x-1/2">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className="type-chat-meta text-white/55 transition-colors hover:text-white/85"
        >
          {t('filingNumber')}
        </a>
      </div>
    </div>
  )
}
