import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button } from './button'

const languages = [
  { code: 'en', labelKey: 'switchToEn' },
  { code: 'zh-CN', labelKey: 'switchToZh' },
]

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'zh-CN' ? 'en' : 'zh-CN'
    i18n.changeLanguage(nextLang)
    localStorage.setItem('i18nextLng', nextLang)
  }

  const currentLang = languages.find(l => l.code === i18n.language) || languages[0]

  return (
    <Button
      variant="ghost"
      size="sm"
      className="type-chat-action gap-1.5"
      onClick={toggleLanguage}
    >
      <Languages className="size-4" />
      <span>{t(currentLang.labelKey)}</span>
    </Button>
  )
}
