import i18n from '@/i18n'
import type { ContentBlock } from './chat-types'

const SESSION_TITLE_MAX_LENGTH = 24
const TITLE_PREFIX_PATTERNS = [
  /^(你好|您好|hi|hello|hey)[，,！!。.\s]*/i,
  /^(请问一下|请问|麻烦你|麻烦|请帮我|请你帮我|帮我|可以帮我|能不能帮我|能否帮我|我想请你|我想让你|我想要|我想看|我想找|我想|我需要|想找|帮我找|请帮我找|请你找|请你帮我找)[，,\s]*/i,
  /^(介绍一下|介绍下|演示一下|演示下|示范一下|示范下)[，,\s]*/i,
]
const TITLE_VERB_PREFIX_PATTERN = /^(找|搜|搜索|检索|查找|看看|看一下|看下)[：:\s]*/i

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function stripLeadIn(value: string): string {
  let next = compactWhitespace(value)
  if (!next) return ''

  let previous = ''
  while (previous !== next) {
    previous = next
    for (const pattern of TITLE_PREFIX_PATTERNS) {
      next = next.replace(pattern, '').trim()
    }
  }

  return next.replace(TITLE_VERB_PREFIX_PATTERN, '').trim()
}

function trimTitle(value: string): string {
  const cleaned = stripLeadIn(value) || compactWhitespace(value)
  return cleaned
    .replace(/^(标题|title)\s*[:：-]\s*/i, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/[，,。.!！？?：:；;、/ ]+$/g, '')
    .slice(0, SESSION_TITLE_MAX_LENGTH)
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
