export interface SearchRequestMessageRef {
  kind: "search_request"
  search_request_id: string
  label?: string
  source?: string
}

export interface BundleGroupMessageRef {
  kind: "bundle_group"
  artifact_id: string
  group_id: string
  label?: string
}

export interface SearchPlanMessageRef {
  kind: "search_plan"
  session_id: string
  label?: string
  query?: string
  categories?: string[]
  brand?: string
  gender?: string
  quarter?: string
  year_min?: number
  image_type?: string
  source?: string
}

export type MessageRefTarget = SearchRequestMessageRef | BundleGroupMessageRef | SearchPlanMessageRef

export interface MessageRefAnnotationItem {
  index?: number
  label?: string
  target: MessageRefTarget
  phrases?: string[]
}

export interface MessageRefsAnnotation {
  type: "message_refs"
  count?: number
  items?: MessageRefAnnotationItem[]
}

export interface MessageRefSpanItem {
  quote: string
  occurrence?: number
  label?: string
  target: MessageRefTarget
}

export interface MessageRefSpansAnnotation {
  type: "message_ref_spans"
  count?: number
  items?: MessageRefSpanItem[]
}

export type MessageAnnotation =
  | MessageRefsAnnotation
  | MessageRefSpansAnnotation
  | { type: string; [key: string]: unknown }

export interface MessageTextMarks {
  strong?: boolean
  emphasis?: boolean
}

export type MessageRenderSegment =
  | { type: "text"; text: string }
  | { type: "ref"; text: string; target: MessageRefTarget; marks?: MessageTextMarks }

const MESSAGE_REF_PREFIX = "aimoda://ref/"
const STRUCTURED_REFS_START = "[AIMODA_REFS]"
const STRUCTURED_REFS_END = "[/AIMODA_REFS]"
const LEGACY_MESSAGE_REF_LINK_RE = /\[([^\]]+)\]\((aimoda:\/\/ref\/[^)]+)\)/g

type ReplacementRange = {
  start: number
  end: number
  text: string
  target: MessageRefTarget
  marks?: MessageTextMarks
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  return decodeURIComponent(
    Array.from(atob(padded))
      .map(char => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join(""),
  )
}

export function parseMessageRefUrl(href: string): MessageRefTarget | null {
  if (!href.startsWith(MESSAGE_REF_PREFIX)) return null
  const encoded = href.slice(MESSAGE_REF_PREFIX.length)
  if (!encoded) return null

  try {
    const parsed = JSON.parse(decodeBase64Url(encoded)) as Record<string, unknown>
    if (parsed.kind === "search_request" && typeof parsed.search_request_id === "string") {
      return {
        kind: "search_request",
        search_request_id: parsed.search_request_id,
        label: typeof parsed.label === "string" ? parsed.label : undefined,
        source: typeof parsed.source === "string" ? parsed.source : undefined,
      }
    }
    if (
      parsed.kind === "bundle_group"
      && typeof parsed.artifact_id === "string"
      && typeof parsed.group_id === "string"
    ) {
      return {
        kind: "bundle_group",
        artifact_id: parsed.artifact_id,
        group_id: parsed.group_id,
        label: typeof parsed.label === "string" ? parsed.label : undefined,
      }
    }
    if (
      parsed.kind === "search_plan"
      && typeof parsed.session_id === "string"
    ) {
      return {
        kind: "search_plan",
        session_id: parsed.session_id,
        label: typeof parsed.label === "string" ? parsed.label : undefined,
        query: typeof parsed.query === "string" ? parsed.query : undefined,
        categories: Array.isArray(parsed.categories)
          ? parsed.categories.filter((item): item is string => typeof item === "string")
          : undefined,
        brand: typeof parsed.brand === "string" ? parsed.brand : undefined,
        gender: typeof parsed.gender === "string" ? parsed.gender : undefined,
        quarter: typeof parsed.quarter === "string" ? parsed.quarter : undefined,
        year_min: typeof parsed.year_min === "number" ? parsed.year_min : undefined,
        image_type: typeof parsed.image_type === "string" ? parsed.image_type : undefined,
        source: typeof parsed.source === "string" ? parsed.source : undefined,
      }
    }
  } catch {
    return null
  }

  return null
}

function encodeBase64Url(input: string): string {
  const utf8 = encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
  return btoa(utf8)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function buildMessageRefUrl(target: MessageRefTarget): string {
  return `${MESSAGE_REF_PREFIX}${encodeBase64Url(JSON.stringify(target))}`
}

function escapeMarkdownLabel(text: string): string {
  return text.replace(/[\[\]()]/g, "\\$&")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isAsciiWordPhrase(value: string): boolean {
  return /^[A-Za-z0-9 _-]+$/.test(value)
}

function findPhraseRange(
  text: string,
  phrase: string,
  occupied: Array<{ start: number; end: number }>,
): { start: number; end: number } | null {
  const trimmed = phrase.trim()
  if (!trimmed) return null

  const patterns = isAsciiWordPhrase(trimmed)
    ? [
        new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(trimmed)})(?=$|[^A-Za-z0-9])`, "i"),
        new RegExp(escapeRegExp(trimmed), "i"),
      ]
    : [new RegExp(escapeRegExp(trimmed))]

  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const matchedText = match[2] ?? match[0]
    const start = match.index + match[0].indexOf(matchedText)
    const end = start + matchedText.length
    const overlaps = occupied.some(range => start < range.end && end > range.start)
    if (!overlaps) {
      return { start, end }
    }
  }

  return null
}

function findNthExactRange(
  text: string,
  phrase: string,
  occurrence: number,
  occupied: Array<{ start: number; end: number }>,
): { start: number; end: number } | null {
  const needle = phrase.trim()
  if (!needle) return null

  let cursor = 0
  let remaining = Math.max(1, occurrence)
  while (remaining > 0) {
    const start = text.indexOf(needle, cursor)
    if (start < 0) return null
    const end = start + needle.length
    remaining -= 1
    cursor = end
    if (remaining > 0) continue
    const overlaps = occupied.some(range => start < range.end && end > range.start)
    if (overlaps) return null
    return { start, end }
  }

  return null
}

function extractOuterMarkdownMarks(
  content: string,
  start: number,
  end: number,
): { start: number; end: number; marks?: MessageTextMarks } {
  let expandedStart = start
  let expandedEnd = end
  const marks: MessageTextMarks = {}
  let changed = true

  while (changed) {
    changed = false

    const beforeStrong = content.slice(Math.max(0, expandedStart - 2), expandedStart)
    const afterStrong = content.slice(expandedEnd, expandedEnd + 2)
    if ((beforeStrong === "**" || beforeStrong === "__") && afterStrong === beforeStrong) {
      expandedStart -= 2
      expandedEnd += 2
      marks.strong = true
      changed = true
      continue
    }

    const beforeEmphasis = content.slice(Math.max(0, expandedStart - 1), expandedStart)
    const afterEmphasis = content.slice(expandedEnd, expandedEnd + 1)
    if ((beforeEmphasis === "*" || beforeEmphasis === "_") && afterEmphasis === beforeEmphasis) {
      const doubledBefore = content.slice(Math.max(0, expandedStart - 2), expandedStart) === beforeEmphasis.repeat(2)
      const doubledAfter = content.slice(expandedEnd, expandedEnd + 2) === afterEmphasis.repeat(2)
      if (!doubledBefore && !doubledAfter) {
        expandedStart -= 1
        expandedEnd += 1
        marks.emphasis = true
        changed = true
      }
    }
  }

  return {
    start: expandedStart,
    end: expandedEnd,
    marks: Object.keys(marks).length > 0 ? marks : undefined,
  }
}

function stripLabelMarkdownMarks(label: string): { text: string; marks?: MessageTextMarks } {
  let text = label
  const marks: MessageTextMarks = {}
  let changed = true

  while (changed) {
    changed = false
    if (
      (text.startsWith("**") && text.endsWith("**"))
      || (text.startsWith("__") && text.endsWith("__"))
    ) {
      text = text.slice(2, -2)
      marks.strong = true
      changed = true
      continue
    }
    if (
      (text.startsWith("*") && text.endsWith("*"))
      || (text.startsWith("_") && text.endsWith("_"))
    ) {
      text = text.slice(1, -1)
      marks.emphasis = true
      changed = true
    }
  }

  return {
    text,
    marks: Object.keys(marks).length > 0 ? marks : undefined,
  }
}

function findSpanReplacements(content: string, annotations?: MessageAnnotation[]): ReplacementRange[] {
  if (!annotations?.length || !content.trim()) return []

  const spanAnnotation = annotations.find(
    (annotation): annotation is MessageRefSpansAnnotation =>
      annotation?.type === "message_ref_spans" && Array.isArray((annotation as MessageRefSpansAnnotation).items),
  )
  if (!spanAnnotation?.items?.length) return []

  const occupied: Array<{ start: number; end: number }> = []
  const replacements: ReplacementRange[] = []

  spanAnnotation.items.forEach((item) => {
    if (!item?.target || typeof item.quote !== "string") return
    const range = findNthExactRange(content, item.quote, item.occurrence ?? 1, occupied)
    if (!range) return
    const markedRange = extractOuterMarkdownMarks(content, range.start, range.end)
    occupied.push({ start: markedRange.start, end: markedRange.end })
    replacements.push({
      start: markedRange.start,
      end: markedRange.end,
      text: content.slice(range.start, range.end),
      target: item.target,
      marks: markedRange.marks,
    })
  })

  return replacements.sort((left, right) => left.start - right.start)
}

function findPhraseReplacements(
  content: string,
  annotations?: MessageAnnotation[],
): { replacements: ReplacementRange[]; fallbackRefs: MessageRenderSegment[] } {
  if (!annotations?.length || !content.trim()) {
    return { replacements: [], fallbackRefs: [] }
  }

  const refAnnotation = annotations.find(
    (annotation): annotation is MessageRefsAnnotation =>
      annotation?.type === "message_refs" && Array.isArray((annotation as MessageRefsAnnotation).items),
  )
  if (!refAnnotation?.items?.length) {
    return { replacements: [], fallbackRefs: [] }
  }

  const occupied: Array<{ start: number; end: number }> = []
  const replacements: ReplacementRange[] = []
  const fallbackRefs: MessageRenderSegment[] = []

  refAnnotation.items.forEach((item, index) => {
    const phrases = (item.phrases ?? []).filter(
      (phrase): phrase is string => typeof phrase === "string" && phrase.trim().length > 0,
    )
    let range: { start: number; end: number } | null = null

    for (const phrase of phrases) {
      range = findPhraseRange(content, phrase, occupied)
      if (range) break
    }

    if (!range) {
      if (fallbackRefs.length > 0) {
        fallbackRefs.push({ type: "text", text: " " })
      } else {
        fallbackRefs.push({ type: "text", text: " " })
      }
      fallbackRefs.push({
        type: "ref",
        text: `[${index + 1}]`,
        target: item.target,
      })
      return
    }

    const markedRange = extractOuterMarkdownMarks(content, range.start, range.end)
    occupied.push({ start: markedRange.start, end: markedRange.end })
    replacements.push({
      start: markedRange.start,
      end: markedRange.end,
      text: content.slice(range.start, range.end),
      target: item.target,
      marks: markedRange.marks,
    })
  })

  return {
    replacements: replacements.sort((left, right) => left.start - right.start),
    fallbackRefs,
  }
}

function buildSegmentsFromReplacements(
  content: string,
  replacements: ReplacementRange[],
  fallbackRefs: MessageRenderSegment[] = [],
): MessageRenderSegment[] {
  if (!replacements.length) {
    const segments: MessageRenderSegment[] = content ? [{ type: "text", text: content }] : []
    return fallbackRefs.length ? [...segments, ...fallbackRefs] : segments
  }

  const segments: MessageRenderSegment[] = []
  let cursor = 0

  replacements.forEach((replacement) => {
    if (replacement.start > cursor) {
      segments.push({ type: "text", text: content.slice(cursor, replacement.start) })
    }
    segments.push({
      type: "ref",
      text: replacement.text,
      target: replacement.target,
      marks: replacement.marks,
    })
    cursor = replacement.end
  })

  if (cursor < content.length) {
    segments.push({ type: "text", text: content.slice(cursor) })
  }

  if (fallbackRefs.length > 0) {
    segments.push(...fallbackRefs)
  }

  return segments.filter(segment => segment.type === "ref" || segment.text.length > 0)
}

function parseLegacyMessageRefSegments(content: string): MessageRenderSegment[] {
  const segments: MessageRenderSegment[] = []
  let cursor = 0

  for (const match of content.matchAll(LEGACY_MESSAGE_REF_LINK_RE)) {
    const raw = match[0]
    const label = match[1]
    const href = match[2]
    const start = match.index ?? -1
    if (start < 0) continue
    const target = parseMessageRefUrl(href)
    if (!target) continue

    const parsedLabel = stripLabelMarkdownMarks(label)
    if (start > cursor) {
      segments.push({ type: "text", text: content.slice(cursor, start) })
    }
    segments.push({ type: "ref", text: parsedLabel.text, target, marks: parsedLabel.marks })
    cursor = start + raw.length
  }

  if (cursor === 0) {
    return content ? [{ type: "text", text: content }] : []
  }

  if (cursor < content.length) {
    segments.push({ type: "text", text: content.slice(cursor) })
  }

  return segments.filter(segment => segment.type === "ref" || segment.text.length > 0)
}

export function buildMessageRefSegments(content: string, annotations?: MessageAnnotation[]): MessageRenderSegment[] {
  const visibleContent = stripStructuredRefPayload(content)
  if (!visibleContent) return []

  const spanReplacements = findSpanReplacements(visibleContent, annotations)
  if (spanReplacements.length > 0) {
    return buildSegmentsFromReplacements(visibleContent, spanReplacements)
  }

  const { replacements, fallbackRefs } = findPhraseReplacements(visibleContent, annotations)
  if (replacements.length > 0 || fallbackRefs.length > 0) {
    return buildSegmentsFromReplacements(visibleContent, replacements, fallbackRefs)
  }

  return parseLegacyMessageRefSegments(visibleContent)
}

// Legacy helper kept for backward-compat tests and any pending callers.
export function injectMessageRefMarkdown(content: string, annotations?: MessageAnnotation[]): string {
  const visibleContent = stripStructuredRefPayload(content)
  const segments = buildMessageRefSegments(visibleContent, annotations)
  if (!segments.length) return visibleContent

  return segments
    .map((segment) => {
      if (segment.type === "text") return segment.text
      return `[${escapeMarkdownLabel(segment.text)}](${buildMessageRefUrl(segment.target)})`
    })
    .join("")
}

export function stripStructuredRefPayload(content: string): string {
  const raw = String(content ?? "")
  const completed = raw.replace(
    new RegExp(`${escapeRegExp(STRUCTURED_REFS_START)}[\\s\\S]*?${escapeRegExp(STRUCTURED_REFS_END)}`, "g"),
    "",
  )
  const danglingIndex = completed.indexOf(STRUCTURED_REFS_START)
  const visible = danglingIndex >= 0 ? completed.slice(0, danglingIndex) : completed
  return visible.trimEnd()
}
