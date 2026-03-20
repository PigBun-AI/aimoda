import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { getSessionUser } from '@/features/auth/protected-route'
import { useLoginDialog } from '@/features/auth/auth-store'

const imageConfig = [
  { src: '/cover/Glass Collection.jpg', alt: 'Glass Collection', className: 'left-0 top-[2%] w-[180px] lg:w-[220px]', delay: '0.1s' },
  { src: '/cover/Window Curtain.jpg', alt: 'Window Curtain', className: 'left-[5%] top-[30%] w-[90px] lg:w-[110px]', delay: '0.2s' },
  { src: '/cover/Pearl Earring.jpg', alt: 'Pearl Earring', className: 'left-[15%] top-[12%] w-[130px] lg:w-[160px]', delay: '0.15s' },
  { src: '/cover/Gold Heels.jpg', alt: 'Gold Heels', className: 'left-[35%] top-[2%] w-[140px] lg:w-[170px]', delay: '0.1s' },
  { src: '/cover/Chair Lean.jpg', alt: 'Chair Lean', className: 'left-[50%] top-[2%] w-[140px] lg:w-[170px]', delay: '0.1s' },
  { src: '/cover/Glass Apple.jpg', alt: 'Glass Apple', className: 'right-[20%] top-[2%] w-[120px] lg:w-[150px]', delay: '0.15s' },
  { src: '/cover/Beach Chairs.jpg', alt: 'Beach Chairs', className: '-right-[15%] top-[10%] w-[260px] lg:w-[320px]', delay: '0.2s' },
  { src: '/cover/Long Cape.jpg', alt: 'Long Cape', className: 'left-0 bottom-[2%] w-[190px] lg:w-[230px]', delay: '0.25s' },
  { src: '/cover/Puffer Duo.jpg', alt: 'Puffer Duo', className: 'left-[22%] bottom-[5%] w-[160px] lg:w-[200px]', delay: '0.3s' },
  { src: '/cover/Hug Coat.jpg', alt: 'Hug Coat', className: 'right-[20%] bottom-[2%] w-[180px] lg:w-[220px]', delay: '0.3s' },
  { src: '/cover/Lace Glasses.jpg', alt: 'Lace Glasses', className: 'right-[2%] top-[50%] w-[160px] lg:w-[200px]', delay: '0.25s' },
]

export function CoverPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { openLogin } = useLoginDialog()
  const currentUser = getSessionUser()

  return (
    <div className="relative w-full h-full overflow-hidden bg-background">
      {/* 中央主背景图 */}
      <div className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 z-sticky animate-cover-scale">
        <img src="/cover/Black Feathers.jpg" alt="Black Feathers" className="w-full max-w-[1000px] h-auto" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/20 to-black/30" />
      </div>

      {/* 周围拼贴图片 */}
      {imageConfig.map((img) => (
        <div
          key={img.alt}
          className={`absolute hidden md:block animate-cover-slide-up z-[5] ${img.className}`}
          style={{ animationDelay: img.delay }}
        >
          <img src={img.src} alt={img.alt} className="w-full h-auto hover:scale-105 transition-transform duration-slow shadow-lg" />
        </div>
      ))}

      {/* 中央文字内容 */}
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

      {/* 底部备案信息 */}
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
