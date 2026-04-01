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
      className={`absolute hidden md:block animate-cover-slide-up z-[5] ${asset.className}`}
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
    <div className="relative w-full h-full overflow-hidden bg-background">
      <div className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 z-sticky animate-cover-scale">
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
            className="w-full max-w-[1000px] h-auto"
          />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/20 to-black/30" />
      </div>

      {showDecorations ? decorativeAssets.map((asset) => <DecorativeImage key={asset.alt} asset={asset} />) : null}

      <div className="absolute top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-full flex flex-col items-center z-overlay px-4">
        <h1 className="text-white text-xl md:text-3xl lg:text-4xl mb-8 text-center animate-cover-slide-up drop-shadow-lg" style={{ animationDelay: '0.5s' }}>
          {t('globalOneStopAI')}
        </h1>
        <p className="text-white text-base md:text-xl lg:text-3xl mb-4 text-center animate-cover-slide-up drop-shadow-md" style={{ animationDelay: '0.8s' }}>
          {t('searchDesignMarketing')}
        </p>
        <div className="animate-cover-slide-up" style={{ animationDelay: '1.1s' }}>
          <Button
            variant="ghostGlass"
            className="w-auto h-10 mt-10"
            onClick={() => {
              if (!currentUser) {
                openLogin()
                return
              }
              navigate('/chat')
            }}
          >
            {t('startNow')}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-dropdown">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs transition-colors text-muted-foreground hover:text-foreground"
        >
          {t('filingNumber')}
        </a>
      </div>
    </div>
  )
}
