import type { ContentBlock } from './chat-types'

export function normalizeContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map(block => {
    if (block.type === 'tool_use') {
      return {
        ...block,
        // Persisted assistant messages are fetched only after the turn ends,
        // so blocks without an explicit status should be treated as complete.
        status: block.status ?? 'done',
      }
    }
    if (block.type === 'tool_result') {
      return { ...block }
    }
    return { ...block }
  })
}
