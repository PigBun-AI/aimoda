import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button } from './button'

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'zh-CN', label: '中' }
]

export function LanguageSwitcher() {
  const { i18n } = useTranslation()

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
      className="gap-1.5 text-sm font-medium"
      onClick={toggleLanguage}
    >
      <Languages className="h-4 w-4" />
      <span>{currentLang.label}</span>
    </Button>
  )
}
