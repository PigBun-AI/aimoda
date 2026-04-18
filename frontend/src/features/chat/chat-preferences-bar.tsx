import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FavoriteCollection } from '@/features/favorites/favorites-api'

import {
  DEFAULT_CHAT_PREFERENCE_WEIGHT,
  formatChatPreferenceSiteLabel,
  getChatPreferenceImageTypeLabel,
} from './chat-preference-utils'
import type { ChatPreferenceOptions, ChatSessionPreferences } from './chat-types'

interface ChatPreferencesBarProps {
  value: ChatSessionPreferences
  options: ChatPreferenceOptions
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
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_CHAT_PREFERENCE_WEIGHT
  const matched = CHAT_PREFERENCE_WEIGHT_OPTIONS.find(option => Math.abs(option.value - numeric) < 0.001)
  return String(matched?.value ?? DEFAULT_CHAT_PREFERENCE_WEIGHT)
}

function toggleStringValue(list: string[] | null | undefined, value: string) {
  const values = Array.isArray(list) ? [...list] : []
  return values.includes(value)
    ? values.filter(item => item !== value)
    : [...values, value]
}

function toggleNumberValue(list: number[] | null | undefined, value: number) {
  const values = Array.isArray(list) ? [...list] : []
  return values.includes(value)
    ? values.filter(item => item !== value)
    : [...values, value].sort((left, right) => right - left)
}

export function ChatPreferencesBar({
  value,
  options,
  collections,
  onChange,
  showHeader = true,
  className,
}: ChatPreferencesBarProps) {
  const { t } = useTranslation('common')

  return (
    <div className={className ?? 'flex flex-col gap-5'}>
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

      <section className="grid gap-3 border-y border-border/80 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-1.5">
          <p className="type-chat-kicker text-muted-foreground">
            {t('dnaPreferenceEyebrow')}
          </p>
          <p className="type-chat-meta max-w-[56ch] text-muted-foreground">
            {t('dnaPreferenceHint')}
          </p>
        </div>
        <div className="type-chat-kicker flex min-h-10 items-center border border-border/80 px-3 text-foreground/88">
          {t('dnaPreferenceCount', { count: collections.length })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <div className="grid gap-4 md:grid-cols-2">
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

        <div className="grid gap-4">
          <PreferenceField label={t('chatPreferenceSeasonGroup')}>
            <ToggleGrid
              items={options.season_groups}
              isActive={item => (value.season_groups ?? []).includes(item.value)}
              getLabel={item => (item.value === '春夏' ? t('seasonSpringSummer') : t('seasonFallWinter'))}
              onToggle={item => onChange({
                ...value,
                season_groups: toggleStringValue(value.season_groups, item.value) as Array<'春夏' | '秋冬'>,
              })}
            />
          </PreferenceField>

          <PreferenceField label={t('chatPreferenceYear')}>
            <ToggleGrid
              items={options.years}
              isActive={item => (value.years ?? []).includes(item.value)}
              getLabel={item => String(item.value)}
              onToggle={item => onChange({
                ...value,
                years: toggleNumberValue(value.years, item.value),
              })}
            />
          </PreferenceField>

          <PreferenceField label={t('chatPreferenceSite')}>
            <ToggleGrid
              items={options.sites}
              isActive={item => (value.sources ?? []).includes(item.value)}
              getLabel={item => formatChatPreferenceSiteLabel(item.value)}
              onToggle={item => onChange({
                ...value,
                sources: toggleStringValue(value.sources, item.value),
              })}
              emptyHint={t('chatPreferenceAll')}
            />
          </PreferenceField>

          <PreferenceField label={t('chatPreferenceImageType')}>
            <ToggleGrid
              items={options.image_types}
              isActive={item => (value.image_types ?? []).includes(item.value)}
              getLabel={item => getChatPreferenceImageTypeLabel(item.value, t)}
              onToggle={item => onChange({
                ...value,
                image_types: toggleStringValue(value.image_types, item.value),
              })}
            />
          </PreferenceField>
        </div>
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
    <label className="grid gap-2">
      <span className="type-chat-kicker text-muted-foreground/78">{label}</span>
      {children}
    </label>
  )
}

function ToggleGrid<T extends string | number>({
  items,
  isActive,
  getLabel,
  onToggle,
  emptyHint,
}: {
  items: Array<{ value: T; count?: number }>
  isActive: (item: { value: T; count?: number }) => boolean
  getLabel: (item: { value: T; count?: number }) => string
  onToggle: (item: { value: T; count?: number }) => void
  emptyHint?: string
}) {
  if (items.length === 0) {
    return (
      <div className="type-chat-meta flex min-h-10 items-center border border-dashed border-border/70 px-3 text-muted-foreground/72">
        {emptyHint ?? '—'}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(item => {
        const active = isActive(item)
        return (
          <Button
            key={String(item.value)}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onToggle(item)}
            className={[
              'h-9 rounded-none px-3 type-chat-meta',
              active ? 'border-foreground/55 bg-foreground/6 text-foreground' : 'border-border/80 bg-background text-muted-foreground',
            ].join(' ')}
          >
            {getLabel(item)}
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="ml-2 text-[11px] text-muted-foreground/72">
                {item.count}
              </span>
            )}
          </Button>
        )
      })}
    </div>
  )
}
