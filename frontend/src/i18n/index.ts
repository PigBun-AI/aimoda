import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 导入翻译文件
import enCommon from './locales/en/common.json'
import enAuth from './locales/en/auth.json'
import enReports from './locales/en/reports.json'
import enAdmin from './locales/en/admin.json'

import zhCommon from './locales/zh-CN/common.json'
import zhAuth from './locales/zh-CN/auth.json'
import zhReports from './locales/zh-CN/reports.json'
import zhAdmin from './locales/zh-CN/admin.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon, auth: enAuth, reports: enReports, admin: enAdmin },
      'zh-CN': { common: zhCommon, auth: zhAuth, reports: zhReports, admin: zhAdmin }
    },
    fallbackLng: 'en',  // 默认英文
    ns: ['common', 'auth', 'reports', 'admin'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng'
    }
  })

export default i18n
