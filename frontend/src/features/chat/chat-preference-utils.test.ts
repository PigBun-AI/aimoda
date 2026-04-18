import { describe, expect, it } from 'vitest'

import { areChatPreferencesEqual, normalizeChatPreferences } from './chat-preference-utils'

describe('chat-preference-utils', () => {
  it('normalizes legacy quarter and year fields into compact multi-select preferences', () => {
    expect(normalizeChatPreferences({
      gender: 'female',
      quarter: '早春',
      year: 2026,
      sources: ['wwd', 'vogue'],
      image_types: ['flat_lay', 'model_photo'],
    })).toEqual({
      gender: 'female',
      season_groups: ['春夏'],
      years: [2026],
      sources: ['vogue', 'wwd'],
      image_types: ['model_photo', 'flat_lay'],
      taste_profile_id: null,
      taste_profile_weight: 0.24,
    })
  })

  it('treats reordered multi-select values as the same preference payload', () => {
    expect(areChatPreferencesEqual(
      {
        season_groups: ['秋冬', '春夏'],
        years: [2025, 2026],
        sources: ['wwd', 'vogue'],
        image_types: ['flat_lay', 'model_photo'],
      },
      {
        season_groups: ['春夏', '秋冬'],
        years: [2026, 2025],
        sources: ['vogue', 'wwd'],
        image_types: ['model_photo', 'flat_lay'],
      },
    )).toBe(true)
  })
})
