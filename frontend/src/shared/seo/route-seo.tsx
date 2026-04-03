import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type SeoMeta = {
  title: string
  description: string
  robots: 'index,follow' | 'noindex,nofollow'
  canonical: string
  ogType: 'website'
  image: string
}

function upsertMetaByName(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('name', name)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
  tag.setAttribute('data-seo-managed', 'true')
}

function upsertMetaByProperty(property: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('property', property)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
  tag.setAttribute('data-seo-managed', 'true')
}

function upsertCanonical(href: string) {
  let tag = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!tag) {
    tag = document.createElement('link')
    tag.setAttribute('rel', 'canonical')
    document.head.appendChild(tag)
  }
  tag.setAttribute('href', href)
  tag.setAttribute('data-seo-managed', 'true')
}

function clearAlternates() {
  const alternates = document.head.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][data-seo-managed="true"]')
  alternates.forEach((tag) => tag.remove())
}

function appendAlternate(hrefLang: string, href: string) {
  const tag = document.createElement('link')
  tag.setAttribute('rel', 'alternate')
  tag.setAttribute('hrefLang', hrefLang)
  tag.setAttribute('href', href)
  tag.setAttribute('data-seo-managed', 'true')
  document.head.appendChild(tag)
}

function getSiteOrigin() {
  const configured = import.meta.env.VITE_SITE_URL as string | undefined
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/, '')
  }
  return window.location.origin
}

function getCurrentLang(input: string) {
  return input === 'zh-CN' ? 'zh-CN' : 'en'
}

function buildSeoMeta(pathname: string, lang: 'zh-CN' | 'en', t: (key: string) => string): SeoMeta {
  const siteOrigin = getSiteOrigin()
  const isHome = pathname === '/'
  const title = isHome ? t('common:seoHomeTitle') : t('common:siteTitle')
  const description = isHome ? t('common:seoHomeDescription') : t('common:seoNoindexDescription')
  const canonical = isHome
    ? (lang === 'en' ? `${siteOrigin}/?lang=en` : `${siteOrigin}/`)
    : `${siteOrigin}${pathname}`

  return {
    title,
    description,
    robots: isHome ? 'index,follow' : 'noindex,nofollow',
    canonical,
    ogType: 'website',
    image: `${siteOrigin}/aimoda-logo.svg`,
  }
}

export function RouteSeo() {
  const location = useLocation()
  const { t, i18n } = useTranslation()

  useEffect(() => {
    const lang = getCurrentLang(i18n.resolvedLanguage || i18n.language)
    const seo = buildSeoMeta(location.pathname, lang, t)
    const siteOrigin = getSiteOrigin()

    document.title = seo.title
    document.documentElement.lang = lang

    upsertMetaByName('description', seo.description)
    upsertMetaByName('robots', seo.robots)
    upsertMetaByName('twitter:card', 'summary_large_image')
    upsertMetaByName('twitter:title', seo.title)
    upsertMetaByName('twitter:description', seo.description)
    upsertMetaByName('twitter:image', seo.image)

    upsertMetaByProperty('og:type', seo.ogType)
    upsertMetaByProperty('og:title', seo.title)
    upsertMetaByProperty('og:description', seo.description)
    upsertMetaByProperty('og:url', seo.canonical)
    upsertMetaByProperty('og:site_name', 'Aimoda')
    upsertMetaByProperty('og:image', seo.image)

    upsertCanonical(seo.canonical)
    clearAlternates()

    if (location.pathname === '/') {
      appendAlternate('zh-CN', `${siteOrigin}/`)
      appendAlternate('en', `${siteOrigin}/?lang=en`)
      appendAlternate('x-default', `${siteOrigin}/`)
    }
  }, [i18n.language, i18n.resolvedLanguage, location.pathname, t])

  return null
}
