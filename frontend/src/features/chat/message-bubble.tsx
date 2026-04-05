// MessageBubble — renders user and assistant messages using ContentBlock[]
// Each block is rendered independently: text bubbles, tool cards, search results

import { Fragment, useMemo, useState } from 'react'
import { Search, Filter, X, Eye, Images, Palette, BarChart3, Info, Loader2, CheckCircle2, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  search: 'toolSearch',
  search_style: 'toolSearchStyle',
  explore_colors: 'toolExploreColors',
  analyze_trends: 'toolAnalyzeTrends',
  get_image_details: 'toolGetImageDetails',
  start_collection: 'toolStartCollection',
  add_filter: 'toolAddFilter',
  remove_filter: 'toolRemoveFilter',
  peek_collection: 'toolPeekCollection',
  show_collection: 'toolShowCollection',
  fashion_vision: 'toolFashionVision',
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

function parseToolResultSummary(content: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  try {
    const data = JSON.parse(content)
    if (typeof data === 'object' && data !== null) {
      if ('message' in data && typeof data.message === 'string') return data.message
      if ('status' in data && typeof data.status === 'string') return `${data.status}${data.total != null ? ` (${String(data.total)})` : ''}`
      if ('action' in data && typeof data.action === 'string') {
        return `${data.action}${data.remaining != null ? ` — ${t('toolRemainingResults', { count: data.remaining })}` : ''}`
      }
      if ('error' in data && typeof data.error === 'string') return `${t('error')}: ${data.error}`
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
      <div className="mb-6 flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-normal">
        <div className="max-w-[78%] space-y-2 sm:max-w-[75%]">
          {msg.content.map((block, index) => (
            <UserBlockRenderer key={`user-block-${index}`} block={block} />
          ))}
        </div>
      </div>
    )
  }

  const segments = buildRenderSegments(msg.content)

  return (
    <div className="mb-6 flex justify-start animate-in fade-in slide-in-from-bottom-1 duration-normal">
      <div className="w-full max-w-[90%] space-y-2 sm:max-w-[88%]">
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
  const { t } = useTranslation('common')

  if (block.type === 'text') {
    return block.text ? (
      <div className="border border-primary bg-primary px-4 py-3 text-sm whitespace-pre-wrap text-primary-foreground">
        {block.text}
      </div>
    ) : null
  }

  if (block.type === 'image') {
    return (
      <img
        src={resolveImageSrc(block.source, 560)}
        alt={block.alt_text || block.file_name || t('uploadedImage')}
        className="ml-auto max-h-72 border border-border bg-card object-cover"
      />
    )
  }

  if (block.type === 'document') {
    return (
      <div className="border border-border bg-primary px-3 py-2 text-xs text-primary-foreground/90">
        {block.file_name ? t('uploadedFileNamed', { fileName: block.file_name }) : t('uploadedFile')}
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
  const { t } = useTranslation('common')
  if (block.type === 'text') return <TextBlockView block={block} />
  if (block.type === 'reasoning') return <ReasoningBlockView block={block} />
  if (block.type === 'image') {
    return (
      <img
        src={resolveImageSrc(block.source, 560)}
        alt={block.alt_text || block.file_name || t('assistantImage')}
        className="max-h-72 border border-border bg-card object-cover"
      />
    )
  }
  if (block.type === 'document') {
    return (
      <div className="border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        {block.file_name ? t('documentFileNamed', { fileName: block.file_name }) : t('documentFile')}
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
  const { t } = useTranslation('common')

  return (
    <div className="overflow-hidden border border-border bg-card animate-in fade-in slide-in-from-bottom-1 duration-normal">
      <div className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-accent">
            <Images size={15} className="text-primary" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
            <div className="h-3 w-44 rounded bg-muted/80 animate-pulse" />
          </div>
        </div>
        <div className="inline-flex items-center gap-2 border border-border bg-background px-3 py-1.5">
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
          <span className="type-ui-label-sm text-muted-foreground">{t('generatingResults')}</span>
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
  const { t } = useTranslation('common')
  const stats = useMemo(() => getToolTraceStats(blocks), [blocks])
  const resolvedToolUseIds = useMemo(
    () => new Set(
      blocks
        .filter((block): block is Extract<ContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
        .map((block) => block.tool_use_id),
    ),
    [blocks],
  )
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className="overflow-hidden border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
          <span className="type-ui-label-sm text-foreground/84">{t('toolTraceTitle')}</span>
          <span className="type-ui-label-xs text-muted-foreground">{t('toolCallsCount', { count: stats.toolCount })}</span>
          {stats.runningCount > 0 && <span className="type-ui-label-xs text-foreground">{t('toolRunningCount', { count: stats.runningCount })}</span>}
          {stats.errorCount > 0 && <span className="type-ui-label-xs text-foreground">{t('toolErrorCount', { count: stats.errorCount })}</span>}
          {stats.toolCount > 0 && stats.runningCount === 0 && stats.errorCount === 0 && (
            <span className="type-ui-label-xs text-foreground">{t('toolDoneCount', { count: stats.doneCount })}</span>
          )}
        </div>
        <span className="type-ui-label-xs text-muted-foreground">{collapsed ? t('expand') : t('collapse')}</span>
      </button>

      {!collapsed && (
        <div className="space-y-2 border-t border-border bg-background/60 px-3 pb-3 pt-3">
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
    <div className="border border-border bg-secondary px-4 py-3 sm:px-5 sm:py-4">
      <ChatMarkdown content={block.text} />
    </div>
  )
}

function ReasoningBlockView({ block }: { block: { type: 'reasoning'; text: string } }) {
  const { t } = useTranslation('common')
  const [collapsed, setCollapsed] = useState(true)

  if (!block.text.trim()) return null

  return (
    <div className="overflow-hidden border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
          <span className="type-ui-label-sm text-foreground/84">
            {t('reasoningTraceTitle')}
          </span>
        </div>
        <span className="type-ui-label-xs text-muted-foreground">
          {collapsed ? t('expand') : t('collapse')}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-border bg-background/60 px-4 py-3">
          <div className="type-ui-body-md border-l border-border pl-3 text-muted-foreground">
            <ChatMarkdown content={block.text} />
          </div>
        </div>
      )}
    </div>
  )
}

function ToolCallCard({ block }: { block: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; status?: 'running' | 'done' } }) {
  const { t } = useTranslation('common')
  const IconComp = toolIcons[block.name] || Search
  const label = toolLabels[block.name] ? t(toolLabels[block.name]) : block.name
  const summary = buildArgsSummary(block.name, block.input)
  const isDone = block.status === 'done'

  return (
    <div className="flex items-center gap-2.5 border border-border bg-muted/35 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-border bg-background">
        <IconComp size={13} className="text-primary" />
      </div>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="type-ui-label-sm text-foreground/84">{label}</span>
        {summary && <span className="type-ui-meta truncate text-muted-foreground">{summary}</span>}
      </div>
      {isDone ? <CheckCircle2 size={12} className="shrink-0 text-foreground" /> : <Loader2 size={12} className="animate-spin shrink-0 opacity-50 text-muted-foreground" />}
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
  const { t } = useTranslation('common')
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
      <div className="type-ui-body-sm ml-3 border-l border-foreground py-1 pl-3 text-foreground">
        {parseToolResultSummary(block.content, t)}
      </div>
    )
  }

  return (
    <div className="type-ui-body-sm ml-3 border-l border-border py-1 pl-3 text-muted-foreground">
      {parseToolResultSummary(block.content, t)}
    </div>
  )
}

function FashionVisionCard({ data }: { data: FashionVisionResultData }) {
  const { t } = useTranslation('common')
  const analysis = data.analysis
  const filterEntries = [
    ...analysis.hard_filters.category.map((value) => ({ label: t('filterCategory'), value })),
    ...analysis.hard_filters.color.map((value) => ({ label: t('filterColor'), value })),
    ...analysis.hard_filters.fabric.map((value) => ({ label: t('filterFabric'), value })),
    ...(analysis.hard_filters.gender ? [{ label: t('filterGender'), value: analysis.hard_filters.gender }] : []),
    ...analysis.hard_filters.season.map((value) => ({ label: t('filterSeason'), value })),
  ]

  return (
    <div className="space-y-3 border border-border bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-accent">
            <Sparkles size={16} className="text-primary" />
          </div>
          <div>
            <div className="type-ui-title-sm text-foreground">{t('toolFashionVision')}</div>
            <div className="type-ui-meta text-muted-foreground">
              {data.image_count ? t('imageCardCount', { count: data.image_count }) : t('imageAnalysis')}
              {data.model ? ` · ${data.model}` : ''}
            </div>
          </div>
        </div>
      </div>

      {analysis.summary_zh && <div className="type-ui-body-md text-foreground">{analysis.summary_zh}</div>}

      {analysis.retrieval_query_en && (
        <div className="border border-border bg-muted/60 px-3 py-2">
          <div className="type-kicker mb-1 text-muted-foreground">Retrieval Query</div>
          <div className="type-ui-body-sm break-words text-foreground">{analysis.retrieval_query_en}</div>
        </div>
      )}

      {analysis.style_keywords.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {analysis.style_keywords.map((keyword) => (
            <span key={keyword} className="type-kicker inline-flex items-center border border-border bg-background px-2.5 py-1 text-foreground">
              {keyword}
            </span>
          ))}
        </div>
      )}

      {filterEntries.length > 0 && (
        <div className="space-y-2">
          <div className="type-ui-meta text-muted-foreground">{t('suggestedHardFilters')}</div>
          <div className="flex flex-wrap gap-2">
            {filterEntries.map((item, index) => (
              <span key={`${item.label}-${item.value}-${index}`} className="type-ui-label-sm inline-flex items-center gap-1 border border-border bg-secondary px-2.5 py-1 text-secondary-foreground">
                  <span className="type-caption text-muted-foreground">{item.label}</span>
                  <span>{item.value}</span>
                </span>
            ))}
          </div>
        </div>
      )}

      {analysis.follow_up_questions_zh.length > 0 && (
        <div className="border border-dashed border-border px-3 py-2">
          <div className="type-kicker mb-1 text-muted-foreground">{t('followUpQuestions')}</div>
          <div className="space-y-1">
            {analysis.follow_up_questions_zh.map((question) => (
              <div key={question} className="type-ui-body-sm text-foreground/82">{question}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StyleKnowledgeCard({ data }: { data: StyleKnowledgeResultData }) {
  const { t } = useTranslation('common')
  const primaryStyle = data.primary_style
  const styleFeatures = data.style_features
  const retrievalPlan = data.retrieval_plan
  const richTextSummary = data.rich_text_summary || data.rich_text
  const suggestedFilters = Object.entries(retrievalPlan?.suggested_filters ?? {})
  const alternatives = data.alternatives ?? []
  const featureGroups = [
    { label: t('stylePalette'), values: styleFeatures?.palette ?? [] },
    { label: t('styleSilhouette'), values: styleFeatures?.silhouette ?? [] },
    { label: t('styleFabric'), values: styleFeatures?.fabric ?? [] },
    { label: t('styleDetails'), values: styleFeatures?.details ?? [] },
  ].filter((group) => group.values.length > 0)

  return (
    <div className="space-y-3 border border-border bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-accent">
            <Sparkles size={16} className="text-primary" />
          </div>
          <div>
            <div className="type-ui-title-sm text-foreground">{t('toolSearchStyle')}</div>
            <div className="type-ui-meta text-muted-foreground">
              {data.query ? t('styleSearchQuery', { query: data.query }) : t('abstractStyleSearch')}
              {data.search_stage ? ` · ${data.search_stage}` : ''}
            </div>
          </div>
        </div>
      </div>

      {data.message && <div className="type-ui-body-md text-foreground">{data.message}</div>}

      {richTextSummary && (
        <div className="type-ui-body-md whitespace-pre-wrap border border-border bg-muted/30 px-3 py-2 text-foreground/90">
          {richTextSummary}
        </div>
      )}

      {primaryStyle?.style_name && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-kicker inline-flex items-center border border-foreground bg-foreground px-2.5 py-1 text-background">
            {primaryStyle.style_name}
          </span>
          {primaryStyle.category && (
            <span className="type-kicker inline-flex items-center border border-border bg-secondary px-2.5 py-1 text-secondary-foreground">
              {primaryStyle.category}
            </span>
          )}
          {primaryStyle.match_type && (
            <span className="type-ui-meta text-muted-foreground">{t('matchType', { value: primaryStyle.match_type })}</span>
          )}
        </div>
      )}

      {retrievalPlan?.retrieval_query_en && (
        <div className="border border-border bg-muted/60 px-3 py-2">
          <div className="type-kicker mb-1 text-muted-foreground">Retrieval Query</div>
          <div className="type-ui-body-sm break-words text-foreground">{retrievalPlan.retrieval_query_en}</div>
        </div>
      )}

      {featureGroups.length > 0 && (
        <div className="space-y-2">
          <div className="type-ui-meta text-muted-foreground">{t('styleFeatures')}</div>
          <div className="flex flex-wrap gap-2">
            {featureGroups.flatMap((group) =>
              group.values.map((value) => (
                <span
                  key={`${group.label}-${value}`}
                  className="type-kicker inline-flex items-center gap-1 border border-border bg-secondary px-2.5 py-1 text-secondary-foreground"
                >
                  <span className="type-caption text-muted-foreground">{group.label}</span>
                  <span>{value}</span>
                </span>
              )),
            )}
          </div>
        </div>
      )}

      {suggestedFilters.length > 0 && (
        <div className="space-y-2">
          <div className="type-ui-meta text-muted-foreground">{t('suggestedFilters')}</div>
          <div className="flex flex-wrap gap-2">
            {suggestedFilters.flatMap(([key, rawValue]) => {
              const values = Array.isArray(rawValue) ? rawValue : [rawValue]
              return values.map((value) => (
                <span
                  key={`${key}-${String(value)}`}
                  className="type-kicker inline-flex items-center gap-1 border border-border bg-background px-2.5 py-1 text-foreground"
                >
                  <span className="type-caption text-muted-foreground">{key}</span>
                  <span>{String(value)}</span>
                </span>
              ))
            })}
          </div>
        </div>
      )}

      {alternatives.length > 0 && (
        <div className="border border-dashed border-border px-3 py-2">
          <div className="type-kicker mb-1 text-muted-foreground">{t('relatedStyles')}</div>
          <div className="flex flex-wrap gap-2">
            {alternatives.map((item) => (
              <span key={`${item.style_name}-${item.match_type ?? 'alt'}`} className="type-ui-body-sm text-foreground/82">
                {item.style_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.fallback_suggestion && (
        <div className="type-ui-body-sm border border-dashed border-border px-3 py-2 text-muted-foreground">
          {data.fallback_suggestion}
        </div>
      )}
    </div>
  )
}
