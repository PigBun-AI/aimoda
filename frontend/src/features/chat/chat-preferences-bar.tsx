import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ChatSessionPreferences } from './chat-types'
import type { FavoriteCollection } from '@/features/favorites/favorites-api'

interface ChatPreferencesBarProps {
  value: ChatSessionPreferences
  collections: FavoriteCollection[]
  onChange: (next: ChatSessionPreferences) => void
  showHeader?: boolean
  className?: string
}

export const CHAT_PREFERENCE_WEIGHT_OPTIONS = [
  { value: 0.12, labelKey: 'chatPreferenceWeightLow' },
  { value: 0.24, labelKey: 'chatPreferenceWeightStandard' },
  { value: 0.4, labelKey: 'chatPreferenceWeightStrong' },
  { value: 0.6, labelKey: 'chatPreferenceWeightMaximum' },
]

export function normalizeChatPreferenceWeightValue(value: number | null | undefined) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0.24
  const matched = CHAT_PREFERENCE_WEIGHT_OPTIONS.find(option => Math.abs(option.value - numeric) < 0.001)
  return String(matched?.value ?? 0.24)
}

export function ChatPreferencesBar({
  value,
  collections,
  onChange,
  showHeader = true,
  className,
}: ChatPreferencesBarProps) {
  const { t } = useTranslation('common')
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return Array.from({ length: 10 }, (_, index) => currentYear - index)
  }, [])

  return (
    <div className={className ?? 'flex flex-col gap-3'}>
      {showHeader && (
        <div className="space-y-1">
          <p className="type-chat-kicker text-muted-foreground/72">
            {t('chatPreferencesTitle')}
          </p>
          <p className="type-chat-meta text-muted-foreground/82">
            {t('chatPreferencesHint')}
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <PreferenceField label={t('chatPreferenceGender')}>
          <Select
            value={value.gender ?? 'none'}
            onValueChange={next => onChange({ ...value, gender: next === 'none' ? null : next as 'female' | 'male' })}
          >
            <SelectTrigger className="h-10 rounded-none border-border/80 bg-background type-chat-meta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border/80">
              <SelectItem value="none">{t('chatPreferenceAll')}</SelectItem>
              <SelectItem value="female">{t('chatPreferenceFemale')}</SelectItem>
              <SelectItem value="male">{t('chatPreferenceMale')}</SelectItem>
            </SelectContent>
          </Select>
        </PreferenceField>

        <PreferenceField label={t('chatPreferenceQuarter')}>
          <Select
            value={value.quarter ?? 'none'}
            onValueChange={next => onChange({ ...value, quarter: next === 'none' ? null : next as '早春' | '春夏' | '早秋' | '秋冬' })}
          >
            <SelectTrigger className="h-10 rounded-none border-border/80 bg-background type-chat-meta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border/80">
              <SelectItem value="none">{t('chatPreferenceAll')}</SelectItem>
              <SelectItem value="早春">{t('chatPreferenceQuarterResort')}</SelectItem>
              <SelectItem value="春夏">{t('chatPreferenceQuarterSS')}</SelectItem>
              <SelectItem value="早秋">{t('chatPreferenceQuarterPreFall')}</SelectItem>
              <SelectItem value="秋冬">{t('chatPreferenceQuarterFW')}</SelectItem>
            </SelectContent>
          </Select>
        </PreferenceField>

        <PreferenceField label={t('chatPreferenceYear')}>
          <Select
            value={value.year != null ? String(value.year) : 'none'}
            onValueChange={next => onChange({ ...value, year: next === 'none' ? null : Number(next) })}
          >
            <SelectTrigger className="h-10 rounded-none border-border/80 bg-background type-chat-meta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border/80">
              <SelectItem value="none">{t('chatPreferenceAll')}</SelectItem>
              {yearOptions.map(year => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PreferenceField>

        <PreferenceField label={t('chatPreferenceTasteProfile')}>
          <Select
            value={value.taste_profile_id ?? 'none'}
            onValueChange={next => onChange({ ...value, taste_profile_id: next === 'none' ? null : next })}
          >
            <SelectTrigger className="h-10 rounded-none border-border/80 bg-background type-chat-meta">
              <SelectValue placeholder={t('favoriteDrawerSelect')} />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border/80">
              <SelectItem value="none">{t('chatPreferenceAll')}</SelectItem>
              {collections.map(collection => (
                <SelectItem key={collection.id} value={collection.id}>
                  {collection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PreferenceField>

        <PreferenceField label={t('chatPreferenceTasteWeight')}>
          <Select
            value={normalizeChatPreferenceWeightValue(value.taste_profile_weight)}
            onValueChange={next => onChange({ ...value, taste_profile_weight: Number(next) })}
            disabled={!value.taste_profile_id}
          >
            <SelectTrigger className="h-10 rounded-none border-border/80 bg-background type-chat-meta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border/80">
              {CHAT_PREFERENCE_WEIGHT_OPTIONS.map(option => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PreferenceField>
      </div>
    </div>
  )
}

function PreferenceField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="type-chat-kicker text-muted-foreground/78">{label}</span>
      {children}
    </label>
  )
}
