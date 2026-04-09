import { Fragment, memo, type ComponentProps, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  buildMessageRefSegments,
  stripStructuredRefPayload,
  type MessageAnnotation,
  type MessageRefTarget,
  type MessageRenderSegment,
} from "./message-refs"

interface ChatMarkdownProps {
  content: string
  annotations?: MessageAnnotation[]
  onMessageRefClick?: (target: MessageRefTarget) => void
}

function ExternalMarkdown({ content, inline = false }: { content: string; inline?: boolean }) {
  const components = inline
    ? {
        p: ({ children }: { children?: ReactNode }) => <>{children}</>,
        a: ({ node: _node, children, ...props }: ComponentProps<"a"> & { node?: unknown }) => (
          <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>
        ),
      }
    : {
        a: ({ node: _node, children, ...props }: ComponentProps<"a"> & { node?: unknown }) => (
          <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>
        ),
      }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  )
}

function InlineRefSegment({
  segment,
  onMessageRefClick,
}: {
  segment: Extract<MessageRenderSegment, { type: "ref" }>
  onMessageRefClick?: (target: MessageRefTarget) => void
}) {
  const typeClassName = [
    segment.marks?.strong ? "font-semibold" : "",
    segment.marks?.emphasis ? "italic" : "",
  ].filter(Boolean).join(" ")

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onMessageRefClick?.(segment.target)
      }}
      className={`inline cursor-pointer border-b border-foreground/25 bg-transparent px-[1px] py-0 text-foreground outline-none transition-[border-color,background-color,color,opacity] duration-150 ease-out hover:border-foreground/55 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:border-foreground/60 focus-visible:bg-foreground/[0.06] ${typeClassName}`.trim()}
    >
      {segment.text}
    </button>
  )
}

function StructuredMarkdown({
  segments,
  onMessageRefClick,
}: {
  segments: MessageRenderSegment[]
  onMessageRefClick?: (target: MessageRefTarget) => void
}) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <Fragment key={`text-${index}`}>
              <ExternalMarkdown content={segment.text} inline />
            </Fragment>
          )
        }

        return (
          <InlineRefSegment
            key={`ref-${index}`}
            segment={segment}
            onMessageRefClick={onMessageRefClick}
          />
        )
      })}
    </>
  )
}

export const ChatMarkdown = memo(function ChatMarkdown({ content, annotations, onMessageRefClick }: ChatMarkdownProps) {
  const visibleContent = stripStructuredRefPayload(content)
  const segments = buildMessageRefSegments(visibleContent, annotations)
  const hasInlineRefs = segments.some(segment => segment.type === "ref")

  return (
    <div className="chat-markdown type-chat-body text-foreground/86">
      {hasInlineRefs
        ? <StructuredMarkdown segments={segments} onMessageRefClick={onMessageRefClick} />
        : <ExternalMarkdown content={visibleContent} />}
    </div>
  )
})
