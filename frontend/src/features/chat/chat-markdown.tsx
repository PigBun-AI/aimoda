import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatMarkdownProps {
  content: string
}

export const ChatMarkdown = memo(function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <div className="chat-markdown text-[13.5px] text-foreground/80 leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
