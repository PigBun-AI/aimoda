// MessageBubble — renders user and assistant messages using ContentBlock[]
// Each block is rendered independently: text bubbles, tool cards, search results

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Search, Filter, X, Eye, Images, Palette, BarChart3, Info, Loader2, CheckCircle2, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import type {
  ChatMessage,
  ContentBlock,
  ImageSource,
  SearchResultData,
  ImageResult,
  FashionVisionResultData,
  StyleKnowledgeResultData,
} from './chat-types'
import { SearchResultCard } from './search-result-card'
import { ChatMarkdown } from './chat-markdown'
import { getOssThumbnailUrl } from './oss-image'

const toolIcons: Record<string, typeof Search> = {
  search: Search,
  search_style: Sparkles,
  explore_colors: Palette,
  analyze_trends: BarChart3,
  get_image_details: Info,
  start_collection: Search,
  add_filter: Filter,
  remove_filter: X,
  peek_collection: Eye,
  show_collection: Images,
  fashion_vision: Sparkles,
}

const toolLabels: Record<string, string> = {
  search: '智能检索',
  search_style: '风格库检索',
  explore_colors: '色彩探索',
  analyze_trends: '趋势分析',
  get_image_details: '查看详情',
  start_collection: '开启新检索',
  add_filter: '添加过滤条件',
  remove_filter: '移除过滤条件',
  peek_collection: '后台自查',
  show_collection: '检索结果',
  fashion_vision: '时尚视觉分析',
}

function parseShowCollectionResult(content: string): SearchResultData | null {
  try {
    const data = JSON.parse(content)
    if (data?.action === 'show_collection' && typeof data?.search_request_id === 'string') {
      return data as SearchResultData
    }
  } catch {}
  return null
}

function parseFashionVisionResult(content: string): FashionVisionResultData | null {
  try {
    const data = JSON.parse(content)
    if (
      data &&
      typeof data === 'object' &&
      data.analysis &&
      typeof data.analysis === 'object' &&
      typeof data.analysis.retrieval_query_en === 'string'
    ) {
      return data as FashionVisionResultData
    }
  } catch {}
  return null
}

function parseStyleKnowledgeResult(content: string): StyleKnowledgeResultData | null {
  try {
    const data = JSON.parse(content)
    if (!data || typeof data !== 'object') return null
    if (typeof data.status !== 'string') return null
    if ('primary_style' in data || 'retrieval_plan' in data || 'fallback_suggestion' in data) {
      return data as StyleKnowledgeResultData
    }
  } catch {}
  return null
}

function parseToolResultSummary(content: string): string {
  try {
    const data = JSON.parse(content)
    if (typeof data === 'object' && data !== null) {
      if ('message' in data && typeof data.message === 'string') return data.message
      if ('status' in data && typeof data.status === 'string') return `${data.status}${data.total != null ? ` (${String(data.total)})` : ''}`
      if ('action' in data && typeof data.action === 'string') return `${data.action}${data.remaining != null ? ` — ${String(data.remaining)} 结果` : ''}`
      if ('error' in data && typeof data.error === 'string') return `错误: ${data.error}`
      const compact = JSON.stringify(data)
      return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact
    }
  } catch {}
  return content.length > 120 ? `${content.slice(0, 120)}...` : content
}

function hasToolResultError(content: string): boolean {
  try {
    const data = JSON.parse(content)
    return typeof data?.error === 'string' && data.error.length > 0
  } catch {}
  return false
}

function buildArgsSummary(name: string, args: Record<string, unknown>): string {
  if (args.query) return `"${String(args.query)}"`
  if (name === 'add_filter' || name === 'remove_filter') {
    const dim = args.dimension ? String(args.dimension) : ''
    const val = args.value ? `="${String(args.value)}"` : ''
    const cat = args.category ? ` (${String(args.category)})` : ''
    return `${dim}${val}${cat}`
  }
  return ''
}

function resolveImageSrc(source: ImageSource, thumbnailWidth?: number): string {
  if (source.type === 'url') {
    return thumbnailWidth ? getOssThumbnailUrl(source.url, thumbnailWidth) : source.url
  }
  return `data:${source.media_type};base64,${source.data}`
}

interface MessageBubbleProps {
  msg: ChatMessage
  onOpenDrawer?: (searchRequestId: string) => void
}

type RenderSegment =
  | { kind: 'block'; block: ContentBlock; key: string }
  | { kind: 'tool_group'; blocks: ContentBlock[]; key: string }

export function MessageBubble({ msg, onOpenDrawer }: MessageBubbleProps) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end mb-5 animate-in fade-in slide-in-from-bottom-1 duration-normal">
        <div className="max-w-[70%] sm:max-w-[75%] space-y-2">
          {msg.content.map((block, index) => (
            <UserBlockRenderer key={`user-block-${index}`} block={block} />
          ))}
        </div>
      </div>
    )
  }

  const segments = buildRenderSegments(msg.content)

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

function UserBlockRenderer({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    return block.text ? (
      <div className="bg-primary text-primary-foreground rounded-bubble rounded-br-sm px-4 py-2.5 shadow-sm text-sm whitespace-pre-wrap">
        {block.text}
      </div>
    ) : null
  }

  if (block.type === 'image') {
    return (
      <img
        src={resolveImageSrc(block.source, 560)}
        alt={block.alt_text || block.file_name || 'uploaded image'}
        className="max-h-72 rounded-2xl object-cover border border-border bg-card shadow-sm ml-auto"
      />
    )
  }

  if (block.type === 'document') {
    return (
      <div className="rounded-xl border border-white/15 bg-primary text-primary-foreground/90 px-3 py-2 text-xs shadow-sm">
        已上传文件{block.file_name ? `：${block.file_name}` : ''}
      </div>
    )
  }

  return null
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
      .map((block) => block.tool_use_id),
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

function getToolTraceStats(blocks: ContentBlock[]) {
  const toolUses = blocks.filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
  const toolResults = blocks.filter((block): block is Extract<ContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
  const resolvedToolUseIds = new Set(toolResults.map((block) => block.tool_use_id))
  const runningCount = toolUses.filter((block) => !resolvedToolUseIds.has(block.id)).length
  const doneCount = Math.max(toolUses.length - runningCount, 0)
  const errorCount = toolResults.filter((block) => block.is_error ?? hasToolResultError(block.content)).length
  return { toolCount: toolUses.length, doneCount, runningCount, errorCount }
}

function BlockRenderer({
  block,
  onOpenDrawer,
}: {
  block: ContentBlock
  onOpenDrawer?: (searchRequestId: string) => void
}) {
  if (block.type === 'text') return <TextBlockView block={block} />
  if (block.type === 'image') {
    return (
      <img
        src={resolveImageSrc(block.source, 560)}
        alt={block.alt_text || block.file_name || 'assistant image'}
        className="max-h-72 rounded-2xl border border-border bg-card object-cover shadow-sm"
      />
    )
  }
  if (block.type === 'document') {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-sm">
        文件{block.file_name ? `：${block.file_name}` : ''}
      </div>
    )
  }
  if (block.type === 'tool_use') {
    if (block.name === 'show_collection') return <ShowCollectionPendingCard />
    return <ToolCallCard block={block} />
  }
  if (block.type === 'tool_result') return <ToolResultView block={block} onOpenDrawer={onOpenDrawer} />
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
    </div>
  )
}

function ToolTraceGroup({
  blocks,
  onOpenDrawer,
}: {
  blocks: ContentBlock[]
  onOpenDrawer?: (searchRequestId: string) => void
}) {
  const stats = useMemo(() => getToolTraceStats(blocks), [blocks])
  const resolvedToolUseIds = useMemo(
    () => new Set(
      blocks
        .filter((block): block is Extract<ContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
        .map((block) => block.tool_use_id),
    ),
    [blocks],
  )
  const shouldOpen = stats.runningCount > 0 || stats.errorCount > 0
  const [collapsed, setCollapsed] = useState(!shouldOpen)

  useEffect(() => {
    if (shouldOpen) {
      setCollapsed(false)
    }
  }, [shouldOpen])

  return (
    <div className="rounded-bubble border border-border/70 bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
          <span className="text-xs font-medium text-foreground/80">工具执行记录</span>
          <span className="text-xs text-muted-foreground">{stats.toolCount} 个调用</span>
          {stats.runningCount > 0 && <span className="text-xs text-primary">执行中 {stats.runningCount}</span>}
          {stats.errorCount > 0 && <span className="text-xs text-destructive">异常 {stats.errorCount}</span>}
          {stats.toolCount > 0 && stats.runningCount === 0 && stats.errorCount === 0 && (
            <span className="text-xs text-success">已完成 {stats.doneCount}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{collapsed ? '展开' : '收起'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/60 bg-background/60">
          {blocks.map((block, index) => (
            <BlockRenderer
              key={index}
              block={
                block.type === 'tool_use' && !resolvedToolUseIds.has(block.id)
                  ? { ...block, status: 'running' }
                  : block
              }
              onOpenDrawer={onOpenDrawer}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TextBlockView({ block }: { block: { type: 'text'; text: string } }) {
  if (!block.text) return null
  return (
    <div className="bg-secondary rounded-bubble rounded-tl-sm px-3 sm:px-5 py-2.5 sm:py-3.5 border border-border shadow-sm">
      <ChatMarkdown content={block.text} />
    </div>
  )
}

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
        {summary && <span className="text-xs text-muted-foreground truncate">{summary}</span>}
      </div>
      {isDone ? <CheckCircle2 size={12} className="text-success shrink-0" /> : <Loader2 size={12} className="text-muted-foreground animate-spin shrink-0 opacity-50" />}
    </div>
  )
}

function ToolResultView({
  block,
  onOpenDrawer,
}: {
  block: { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; images?: ImageResult[]; metadata?: Record<string, unknown> }
  onOpenDrawer?: (searchRequestId: string) => void
}) {
  const showCollectionData = useMemo(() => parseShowCollectionResult(block.content), [block.content])
  const fashionVisionData = useMemo(() => parseFashionVisionResult(block.content), [block.content])
  const styleKnowledgeData = useMemo(() => parseStyleKnowledgeResult(block.content), [block.content])
  const isError = block.is_error ?? hasToolResultError(block.content)

  if (showCollectionData && onOpenDrawer) {
    return <SearchResultCard data={showCollectionData} images={block.images} onOpenDrawer={onOpenDrawer} />
  }

  if (fashionVisionData) {
    return <FashionVisionCard data={fashionVisionData} />
  }

  if (styleKnowledgeData) {
    return <StyleKnowledgeCard data={styleKnowledgeData} />
  }

  if (isError) {
    return (
      <div className="py-1 px-3 ml-3 text-xs border-l-2 border-destructive/50 text-destructive">
        {parseToolResultSummary(block.content)}
      </div>
    )
  }

  return (
    <div className="py-1 px-3 ml-3 text-xs border-l-2 border-muted-foreground/30 text-muted-foreground">
      {parseToolResultSummary(block.content)}
    </div>
  )
}

function FashionVisionCard({ data }: { data: FashionVisionResultData }) {
  const analysis = data.analysis
  const filterEntries = [
    ...analysis.hard_filters.category.map((value) => ({ label: '品类', value })),
    ...analysis.hard_filters.color.map((value) => ({ label: '颜色', value })),
    ...analysis.hard_filters.fabric.map((value) => ({ label: '面料', value })),
    ...(analysis.hard_filters.gender ? [{ label: '性别', value: analysis.hard_filters.gender }] : []),
    ...analysis.hard_filters.season.map((value) => ({ label: '季节', value })),
  ]

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles size={16} className="text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">时尚视觉分析</div>
            <div className="text-xs text-muted-foreground">
              {data.image_count ? `${data.image_count} 张图` : '图片分析'}
              {data.model ? ` · ${data.model}` : ''}
            </div>
          </div>
        </div>
      </div>

      {analysis.summary_zh && <div className="text-sm leading-6 text-foreground">{analysis.summary_zh}</div>}

      {analysis.retrieval_query_en && (
        <div className="rounded-xl bg-muted/60 px-3 py-2 border border-border/60">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Retrieval Query</div>
          <div className="text-sm text-foreground break-words">{analysis.retrieval_query_en}</div>
        </div>
      )}

      {analysis.style_keywords.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {analysis.style_keywords.map((keyword) => (
            <span key={keyword} className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
              {keyword}
            </span>
          ))}
        </div>
      )}

      {filterEntries.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">建议硬过滤条件</div>
          <div className="flex flex-wrap gap-2">
            {filterEntries.map((item, index) => (
              <span key={`${item.label}-${item.value}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
                <span className="text-muted-foreground">{item.label}</span>
                <span>{item.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {analysis.follow_up_questions_zh.length > 0 && (
        <div className="rounded-xl border border-dashed border-border px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground mb-1">可追问</div>
          <div className="space-y-1">
            {analysis.follow_up_questions_zh.map((question) => (
              <div key={question} className="text-xs text-foreground/80">{question}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StyleKnowledgeCard({ data }: { data: StyleKnowledgeResultData }) {
  const primaryStyle = data.primary_style
  const styleFeatures = data.style_features
  const retrievalPlan = data.retrieval_plan
  const richTextSummary = data.rich_text_summary || data.rich_text
  const suggestedFilters = Object.entries(retrievalPlan?.suggested_filters ?? {})
  const alternatives = data.alternatives ?? []
  const featureGroups = [
    { label: '色盘', values: styleFeatures?.palette ?? [] },
    { label: '廓形', values: styleFeatures?.silhouette ?? [] },
    { label: '面料', values: styleFeatures?.fabric ?? [] },
    { label: '细节', values: styleFeatures?.details ?? [] },
  ].filter((group) => group.values.length > 0)

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles size={16} className="text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">风格库检索</div>
            <div className="text-xs text-muted-foreground">
              {data.query ? `查询：${data.query}` : '抽象风格检索'}
              {data.search_stage ? ` · ${data.search_stage}` : ''}
            </div>
          </div>
        </div>
      </div>

      {data.message && <div className="text-sm leading-6 text-foreground">{data.message}</div>}

      {richTextSummary && (
        <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-6 text-foreground/90 whitespace-pre-wrap">
          {richTextSummary}
        </div>
      )}

      {primaryStyle?.style_name && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
            {primaryStyle.style_name}
          </span>
          {primaryStyle.category && (
            <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
              {primaryStyle.category}
            </span>
          )}
          {primaryStyle.match_type && (
            <span className="text-xs text-muted-foreground">匹配方式：{primaryStyle.match_type}</span>
          )}
        </div>
      )}

      {retrievalPlan?.retrieval_query_en && (
        <div className="rounded-xl bg-muted/60 px-3 py-2 border border-border/60">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Retrieval Query</div>
          <div className="text-sm text-foreground break-words">{retrievalPlan.retrieval_query_en}</div>
        </div>
      )}

      {featureGroups.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">风格特征</div>
          <div className="flex flex-wrap gap-2">
            {featureGroups.flatMap((group) =>
              group.values.map((value) => (
                <span
                  key={`${group.label}-${value}`}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                >
                  <span className="text-muted-foreground">{group.label}</span>
                  <span>{value}</span>
                </span>
              )),
            )}
          </div>
        </div>
      )}

      {suggestedFilters.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">建议过滤条件</div>
          <div className="flex flex-wrap gap-2">
            {suggestedFilters.flatMap(([key, rawValue]) => {
              const values = Array.isArray(rawValue) ? rawValue : [rawValue]
              return values.map((value) => (
                <span
                  key={`${key}-${String(value)}`}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
                >
                  <span className="text-primary/70">{key}</span>
                  <span>{String(value)}</span>
                </span>
              ))
            })}
          </div>
        </div>
      )}

      {alternatives.length > 0 && (
        <div className="rounded-xl border border-dashed border-border px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground mb-1">相近风格</div>
          <div className="flex flex-wrap gap-2">
            {alternatives.map((item) => (
              <span key={`${item.style_name}-${item.match_type ?? 'alt'}`} className="text-xs text-foreground/80">
                {item.style_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.fallback_suggestion && (
        <div className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {data.fallback_suggestion}
        </div>
      )}
    </div>
  )
}
