import type { FavoriteCollection } from '@/features/favorites/favorites-api'

import type { ChatPreferenceOptions, ChatSessionPreferences } from './chat-types'

export const DEFAULT_CHAT_PREFERENCE_WEIGHT = 0.24
export const CHAT_SEASON_GROUPS = ['春夏', '秋冬'] as const
export const CHAT_IMAGE_TYPE_ORDER = ['model_photo', 'flat_lay'] as const

type LegacyChatPreferences = ChatSessionPreferences & {
  quarter?: '早春' | '春夏' | '早秋' | '秋冬' | null
  year?: number | null
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const normalized: string[] = []
  for (const item of values) {
    const value = String(item ?? '').trim()
    if (value && !normalized.includes(value)) {
      normalized.push(value)
    }
  }
  return normalized
}

function normalizeNumberArray(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  const normalized: number[] = []
  for (const item of values) {
    const numeric = Number(item)
    if (Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2100 && !normalized.includes(numeric)) {
      normalized.push(numeric)
    }
  }
  return normalized.sort((left, right) => right - left)
}

function normalizeSeasonGroupsArray(values: unknown): Array<'春夏' | '秋冬'> {
  return normalizeStringArray(values)
    .filter((value): value is '春夏' | '秋冬' => value === '春夏' || value === '秋冬')
    .sort((left, right) => CHAT_SEASON_GROUPS.indexOf(left) - CHAT_SEASON_GROUPS.indexOf(right))
}

function normalizeImageTypesArray(values: unknown): string[] {
  return normalizeStringArray(values).sort((left, right) => {
    const leftIndex = CHAT_IMAGE_TYPE_ORDER.indexOf(left as typeof CHAT_IMAGE_TYPE_ORDER[number])
    const rightIndex = CHAT_IMAGE_TYPE_ORDER.indexOf(right as typeof CHAT_IMAGE_TYPE_ORDER[number])
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex) || left.localeCompare(right)
  })
}

function legacyQuarterToSeasonGroup(value: LegacyChatPreferences['quarter']): '春夏' | '秋冬' | null {
  if (!value) return null
  if (value === '早春' || value === '春夏') return '春夏'
  if (value === '早秋' || value === '秋冬') return '秋冬'
  return null
}

export function normalizeChatPreferences(preferences?: LegacyChatPreferences | null): ChatSessionPreferences {
  const seasonGroups = normalizeSeasonGroupsArray(preferences?.season_groups)
  const legacySeasonGroup = legacyQuarterToSeasonGroup(preferences?.quarter)
  if (legacySeasonGroup && !seasonGroups.includes(legacySeasonGroup)) {
    seasonGroups.push(legacySeasonGroup)
    seasonGroups.sort((left, right) => CHAT_SEASON_GROUPS.indexOf(left) - CHAT_SEASON_GROUPS.indexOf(right))
  }

  const years = normalizeNumberArray(preferences?.years)
  if (typeof preferences?.year === 'number' && !years.includes(preferences.year)) {
    years.push(preferences.year)
    years.sort((left, right) => right - left)
  }

  return {
    gender: preferences?.gender ?? null,
    season_groups: seasonGroups,
    years,
    sources: normalizeStringArray(preferences?.sources).sort((left, right) => left.localeCompare(right)),
    image_types: normalizeImageTypesArray(preferences?.image_types),
    taste_profile_id: preferences?.taste_profile_id ?? null,
    taste_profile_weight: preferences?.taste_profile_weight ?? DEFAULT_CHAT_PREFERENCE_WEIGHT,
  }
}

export function hasActiveChatPreferences(preferences: ChatSessionPreferences) {
  return Boolean(
    preferences.gender
    || (preferences.season_groups?.length ?? 0) > 0
    || (preferences.years?.length ?? 0) > 0
    || (preferences.sources?.length ?? 0) > 0
    || (preferences.image_types?.length ?? 0) > 0
    || preferences.taste_profile_id,
  )
}

export function areChatPreferencesEqual(
  left: ChatSessionPreferences | null | undefined,
  right: ChatSessionPreferences | null | undefined,
) {
  const normalizedLeft = normalizeChatPreferences(left)
  const normalizedRight = normalizeChatPreferences(right)
  return (
    normalizedLeft.gender === normalizedRight.gender
    && JSON.stringify(normalizedLeft.season_groups) === JSON.stringify(normalizedRight.season_groups)
    && JSON.stringify(normalizedLeft.years) === JSON.stringify(normalizedRight.years)
    && JSON.stringify(normalizedLeft.sources) === JSON.stringify(normalizedRight.sources)
    && JSON.stringify(normalizedLeft.image_types) === JSON.stringify(normalizedRight.image_types)
    && (normalizedLeft.taste_profile_id ?? null) === (normalizedRight.taste_profile_id ?? null)
    && (normalizedLeft.taste_profile_weight ?? DEFAULT_CHAT_PREFERENCE_WEIGHT) === (normalizedRight.taste_profile_weight ?? DEFAULT_CHAT_PREFERENCE_WEIGHT)
  )
}

export function getChatPreferenceImageTypeLabel(
  imageType: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (imageType === 'model_photo') return t('chatPreferenceImageTypeModelPhoto')
  if (imageType === 'flat_lay') return t('chatPreferenceImageTypeFlatLay')
  return imageType
}

export function formatChatPreferenceSiteLabel(site: string) {
  return site
    .split(/[-_]/g)
    .filter(Boolean)
    .map(segment => (segment.length <= 4 ? segment.toUpperCase() : `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`))
    .join(' ')
}

export function buildDefaultChatPreferenceOptions(): ChatPreferenceOptions {
  const currentYear = new Date().getFullYear()
  return {
    sites: [],
    image_types: [
      { value: 'model_photo' },
      { value: 'flat_lay' },
    ],
    years: Array.from({ length: 10 }, (_, index) => ({ value: currentYear - index })),
    season_groups: CHAT_SEASON_GROUPS.map(value => ({ value })),
  }
}

export function summarizeChatPreferences(
  preferences: ChatSessionPreferences,
  collections: FavoriteCollection[],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const parts: string[] = []

  if (preferences.gender) {
    parts.push(t(preferences.gender === 'female' ? 'chatPreferenceFemale' : 'chatPreferenceMale'))
  }
  if ((preferences.season_groups?.length ?? 0) > 0) {
    parts.push(
      preferences.season_groups!
        .map(value => (value === '春夏' ? t('seasonSpringSummer') : t('seasonFallWinter')))
        .join(' / '),
    )
  }
  if ((preferences.years?.length ?? 0) > 0) {
    parts.push(preferences.years!.join(' / '))
  }
  if ((preferences.sources?.length ?? 0) > 0) {
    parts.push(preferences.sources!.map(formatChatPreferenceSiteLabel).join(' / '))
  }
  if ((preferences.image_types?.length ?? 0) > 0) {
    parts.push(preferences.image_types!.map(value => getChatPreferenceImageTypeLabel(value, t)).join(' / '))
  }
  if (preferences.taste_profile_id) {
    const matchedCollection = collections.find(collection => collection.id === preferences.taste_profile_id)
    if (matchedCollection?.name) {
      parts.push(matchedCollection.name)
    }
  }

  return parts.length > 0 ? parts.join(' · ') : t('chatPreferenceAll')
}
