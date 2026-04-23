import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 导入翻译文件
import enCommon from './locales/en/common.json'
import enAuth from './locales/en/auth.json'
import enReports from './locales/en/reports.json'
import enAdmin from './locales/en/admin.json'
import enTrendFlow from './locales/en/trend-flow.json'

import zhCommon from './locales/zh-CN/common.json'
import zhAuth from './locales/zh-CN/auth.json'
import zhReports from './locales/zh-CN/reports.json'
import zhAdmin from './locales/zh-CN/admin.json'
import zhTrendFlow from './locales/zh-CN/trend-flow.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    showSupportNotice: false,
    resources: {
      en: { common: enCommon, auth: enAuth, reports: enReports, admin: enAdmin, 'trend-flow': enTrendFlow },
      'zh-CN': { common: zhCommon, auth: zhAuth, reports: zhReports, admin: zhAdmin, 'trend-flow': zhTrendFlow }
    },
    supportedLngs: ['en', 'zh-CN'],
    fallbackLng: 'en',  // 默认英文
    ns: ['common', 'auth', 'reports', 'admin', 'trend-flow'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng'
    }
  })

export default i18n
