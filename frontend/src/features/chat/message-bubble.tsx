// MessageBubble — renders user and assistant messages using ContentBlock[]
// Each block is rendered independently: text bubbles, tool cards, search results

import { Fragment, useMemo, useState } from 'react'
import { Search, Filter, X, Eye, Images, Palette, BarChart3, Info, Loader2, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import type { ChatMessage, ContentBlock, SearchResultData, SearchSessionState, ImageResult } from './chat-types'
import { SearchResultCard } from './search-result-card'
import { ChatMarkdown } from './chat-markdown'

// ── Tool icon/label maps ──────────────────────────────────────

const toolIcons: Record<string, typeof Search> = {
  search: Search,
  explore_colors: Palette,
  analyze_trends: BarChart3,
  get_image_details: Info,
  start_collection: Search,
  add_filter: Filter,
  remove_filter: X,
  peek_collection: Eye,
  show_collection: Images,
}

const toolLabels: Record<string, string> = {
  search: '智能检索',
  explore_colors: '色彩探索',
  analyze_trends: '趋势分析',
  get_image_details: '查看详情',
  start_collection: '开启新检索',
  add_filter: '添加过滤条件',
  remove_filter: '移除过滤条件',
  peek_collection: '后台自查',
  show_collection: '检索结果',
}

// ── Helpers ───────────────────────────────────────────────────

/** Extract plain text from a ContentBlock array */
function extractText(blocks: ContentBlock[]): string {
  return blocks
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')
}

/** Try to parse show_collection JSON from tool_result content */
function parseShowCollectionResult(content: string): SearchResultData | null {
  try {
    const data = JSON.parse(content)
    if (data?.action === 'show_collection' && data?.search_request) {
      return data as SearchResultData
    }
  } catch { /* not JSON or not show_collection */ }
  return null
}

/** Extract a summary from a tool result JSON string */
function parseToolResultSummary(content: string): string {
  try {
    const data = JSON.parse(content)
    if (typeof data === 'object' && data !== null) {
      // Common patterns
      if (data.message) return data.message
      if (data.status) return `${data.status}${data.total != null ? ` (${data.total})` : ''}`
      if (data.action) return `${data.action}${data.remaining != null ? ` — ${data.remaining} 结果` : ''}`
      if (data.error) return `错误: ${data.error}`
      return JSON.stringify(data).slice(0, 120) + (JSON.stringify(data).length > 120 ? '...' : '')
    }
  } catch { /* plain text */ }
  return content.length > 120 ? content.slice(0, 120) + '...' : content
}

/** Build summary for tool_use args */
function buildArgsSummary(name: string, args: Record<string, unknown>): string {
  if (args.query) return `"${args.query}"`
  if (name === 'add_filter' || name === 'remove_filter') {
    const dim = args.dimension ? String(args.dimension) : ''
    const val = args.value ? `="${args.value}"` : ''
    const cat = args.category ? ` (${args.category})` : ''
    return `${dim}${val}${cat}`
  }
  return ''
}

// ── Props ─────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: ChatMessage
  onOpenDrawer?: (searchRequest: SearchSessionState) => void
}

type RenderSegment =
  | { kind: 'block'; block: ContentBlock; key: string }
  | { kind: 'tool_group'; blocks: ContentBlock[]; key: string }

// ── Component ─────────────────────────────────────────────────

export function MessageBubble({ msg, onOpenDrawer }: MessageBubbleProps) {
  if (msg.role === 'user') {
    const text = extractText(msg.content)
    return (
      <div className="flex justify-end mb-5 animate-in fade-in slide-in-from-bottom-1 duration-normal">
        <div className="bg-primary text-primary-foreground rounded-bubble rounded-br-sm px-4 py-2.5 max-w-[70%] sm:max-w-[75%] shadow-sm text-sm">
          {text}
        </div>
      </div>
    )
  }

  const segments = buildRenderSegments(msg.content)

  // Assistant: render each ContentBlock independently
  return (
    <div className="flex justify-start mb-5 animate-in fade-in slide-in-from-bottom-1 duration-normal">
      <div className="max-w-[85%] sm:max-w-[88%] w-full space-y-2">
        {segments.map((segment) => (
          <Fragment key={segment.key}>
            {segment.kind === 'block' ? (
              <BlockRenderer block={segment.block} onOpenDrawer={onOpenDrawer} />
            ) : (
              <ToolTraceGroup blocks={segment.blocks} onOpenDrawer={onOpenDrawer} />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function buildRenderSegments(blocks: ContentBlock[]): RenderSegment[] {
  const segments: RenderSegment[] = []
  let pendingToolBlocks: ContentBlock[] = []
  let groupIndex = 0
  const resolvedShowCollectionIds = new Set(
    blocks
      .filter(
        (block): block is Extract<ContentBlock, { type: 'tool_result' }> =>
          block.type === 'tool_result' && Boolean(parseShowCollectionResult(block.content)),
      )
      .map(block => block.tool_use_id),
  )

  const flushToolGroup = () => {
    if (pendingToolBlocks.length === 0) return
    segments.push({
      kind: 'tool_group',
      blocks: pendingToolBlocks,
      key: `tool-group-${groupIndex++}`,
    })
    pendingToolBlocks = []
  }

  blocks.forEach((block, index) => {
    if (
      block.type === 'tool_use' &&
      block.name === 'show_collection' &&
      resolvedShowCollectionIds.has(block.id)
    ) {
      return
    }

    if (isCollapsibleToolTrace(block)) {
      pendingToolBlocks.push(block)
      return
    }

    flushToolGroup()
    segments.push({ kind: 'block', block, key: `block-${index}` })
  })

  flushToolGroup()
  return segments
}

function isCollapsibleToolTrace(block: ContentBlock): boolean {
  if (block.type === 'tool_use') return block.name !== 'show_collection'
  if (block.type === 'tool_result') return !parseShowCollectionResult(block.content)
  return false
}

// ── Block Renderer ────────────────────────────────────────────

function BlockRenderer({
  block,
  onOpenDrawer,
}: {
  block: ContentBlock
  onOpenDrawer?: (searchRequest: SearchSessionState) => void
}) {
  if (block.type === 'text') {
    return <TextBlockView block={block} />
  }
  if (block.type === 'tool_use') {
    if (block.name === 'show_collection') {
      return <ShowCollectionPendingCard />
    }
    return <ToolCallCard block={block} />
  }
  if (block.type === 'tool_result') {
    return <ToolResultView block={block} onOpenDrawer={onOpenDrawer} />
  }
  return null
}

function ShowCollectionPendingCard() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-normal">
      <div className="px-3 sm:px-4 py-3 sm:py-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
            <Images size={15} className="text-primary" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
            <div className="h-3 w-44 rounded bg-muted/80 animate-pulse" />
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-muted/70 px-3 py-1.5">
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">正在生成结果</span>
        </div>
      </div>
      <div className="px-4 pb-4">
        <div className="border border-border/60 bg-muted/25 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="h-3 w-16 rounded bg-muted animate-pulse" />
            <div className="h-3 w-10 rounded bg-muted/80 animate-pulse" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-1 min-w-0">
                <div
                  className="bg-muted overflow-hidden relative border border-border/60 animate-pulse"
                  style={{ aspectRatio: '1 / 2' }}
                />
                <div className="h-2.5 w-12 rounded bg-muted/80 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolTraceGroup({
  blocks,
  onOpenDrawer,
}: {
  blocks: ContentBlock[]
  onOpenDrawer?: (searchRequest: SearchSessionState) => void
}) {
  const [collapsed, setCollapsed] = useState(true)
  const toolCount = blocks.filter(block => block.type === 'tool_use').length

  return (
    <div className="rounded-bubble border border-border/70 bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
          <span className="text-xs font-medium text-foreground/80">工具执行记录</span>
          <span className="text-xs text-muted-foreground">{toolCount} 个调用</span>
        </div>
        <span className="text-xs text-muted-foreground">{collapsed ? '展开' : '收起'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/60 bg-background/60">
          {blocks.map((block, index) => (
            <BlockRenderer key={index} block={block} onOpenDrawer={onOpenDrawer} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Text Block ────────────────────────────────────────────────

function TextBlockView({ block }: { block: { type: 'text'; text: string } }) {
  if (!block.text) return null
  return (
    <div className="bg-secondary rounded-bubble rounded-tl-sm px-3 sm:px-5 py-2.5 sm:py-3.5 border border-border shadow-sm">
      <ChatMarkdown content={block.text} />
    </div>
  )
}

// ── Tool Call Card ────────────────────────────────────────────

function ToolCallCard({ block }: { block: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; status?: 'running' | 'done' } }) {
  const IconComp = toolIcons[block.name] || Search
  const label = toolLabels[block.name] || block.name
  const summary = buildArgsSummary(block.name, block.input)
  const isDone = block.status === 'done'

  return (
    <div className="flex items-center gap-2.5 py-1.5 px-3 rounded-xl bg-muted/50 border border-border/50">
      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <IconComp size={13} className="text-primary" />
      </div>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xs font-medium text-foreground/70">{label}</span>
        {summary && (
          <span className="text-xs text-muted-foreground truncate">{summary}</span>
        )}
      </div>
      {isDone
        ? <CheckCircle2 size={12} className="text-success shrink-0" />
        : <Loader2 size={12} className="text-muted-foreground animate-spin shrink-0 opacity-50" />
      }
    </div>
  )
}

// ── Tool Result View ──────────────────────────────────────────

function ToolResultView({
  block,
  onOpenDrawer,
}: {
  block: { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; images?: ImageResult[]; metadata?: Record<string, unknown> }
  onOpenDrawer?: (searchRequest: SearchSessionState) => void
}) {
  // Check if this is a show_collection result
  const showCollectionData = useMemo(
    () => parseShowCollectionResult(block.content),
    [block.content],
  )

  if (showCollectionData && onOpenDrawer) {
    return (
      <SearchResultCard
        data={showCollectionData}
        images={block.images}
        onOpenDrawer={onOpenDrawer}
      />
    )
  }

  // Generic tool result — compact summary
  if (block.is_error) {
    return (
      <div className="py-1 px-3 ml-3 text-xs border-l-2 border-destructive/50 text-destructive">
        {parseToolResultSummary(block.content)}
      </div>
    )
  }

  const summary = parseToolResultSummary(block.content)
  return (
    <div className="py-1 px-3 ml-3 text-xs border-l-2 border-muted-foreground/30 text-muted-foreground">
      {summary}
    </div>
  )
}
