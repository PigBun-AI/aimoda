import i18n from '@/i18n'
import type { ContentBlock } from './chat-types'

const SESSION_TITLE_MAX_LENGTH = 24

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function trimTitle(value: string): string {
  return compactWhitespace(value).slice(0, SESSION_TITLE_MAX_LENGTH)
}

export function deriveSessionTitleFromBlocks(blocks: ContentBlock[]): string | null {
  const firstText = blocks.find((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
  const text = firstText ? trimTitle(firstText.text || '') : ''
  if (text) return text

  const imageCount = blocks.filter(block => block.type === 'image').length
  if (imageCount > 0) {
    return i18n.t('common:imageSearchSessionTitle')
  }

  return null
}
