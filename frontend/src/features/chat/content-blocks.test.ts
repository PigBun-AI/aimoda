import { describe, expect, it } from 'vitest'

import type { ContentBlock } from './chat-types'
import { normalizeContentBlocks } from './content-blocks'

describe('normalizeContentBlocks', () => {
  it('marks persisted tool calls as done when status is absent', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { query: 'dress' } },
      { type: 'tool_result', tool_use_id: 'tool-1', content: '{"ok":true}' },
    ]

    expect(normalizeContentBlocks(blocks)).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { query: 'dress' }, status: 'done' },
      { type: 'tool_result', tool_use_id: 'tool-1', content: '{"ok":true}' },
    ])
  })

  it('preserves interleaved block order', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'A' },
      { type: 'tool_use', id: 'tool-1', name: 'search', input: {} },
      { type: 'tool_result', tool_use_id: 'tool-1', content: '{"step":"B"}' },
      { type: 'tool_use', id: 'tool-2', name: 'add_filter', input: {} },
      { type: 'tool_result', tool_use_id: 'tool-2', content: '{"step":"C"}' },
      { type: 'text', text: 'D' },
    ]

    expect(normalizeContentBlocks(blocks).map(block => block.type)).toEqual([
      'text',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'text',
    ])
  })
})
