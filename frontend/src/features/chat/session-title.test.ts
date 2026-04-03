import { describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import { deriveSessionTitleFromBlocks } from './session-title'

describe('deriveSessionTitleFromBlocks', () => {
  it('uses the first text block as the provisional title', () => {
    expect(
      deriveSessionTitleFromBlocks([
        { type: 'text', text: '  蓝色的连衣裙，优雅通勤一点  ' },
      ]),
    ).toBe('蓝色的连衣裙，优雅通勤一点')
  })

  it('falls back to image search title for image-only turns', () => {
    void i18n.changeLanguage('zh-CN')
    expect(
      deriveSessionTitleFromBlocks([
        {
          type: 'image',
          source: {
            type: 'url',
            url: 'https://example.com/look.jpg',
          },
        },
      ]),
    ).toBe('图片检索')
  })

  it('uses the same image search title for multi-image turns', () => {
    void i18n.changeLanguage('zh-CN')
    expect(
      deriveSessionTitleFromBlocks([
        {
          type: 'image',
          source: {
            type: 'url',
            url: 'https://example.com/look-1.jpg',
          },
        },
        {
          type: 'image',
          source: {
            type: 'url',
            url: 'https://example.com/look-2.jpg',
          },
        },
      ]),
    ).toBe('图片检索')
  })
})
