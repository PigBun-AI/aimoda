import { useState, useCallback } from 'react'
import { ImagePlus, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ChatInputProps {
  onSend?: (message: string) => void
  placeholder?: string
  disabled?: boolean
}

export function ChatInput({
  onSend,
  placeholder,
  disabled = false,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState('')
  const resolvedPlaceholder = placeholder ?? '输入搜索需求，如「找红色连衣裙」「风衣搭配短裙」...'

  const handleSend = useCallback(() => {
    if (!inputValue.trim() || disabled) return
    onSend?.(inputValue.trim())
    setInputValue('')
  }, [inputValue, disabled, onSend])

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled) {
      e.preventDefault()
      handleSend()
    }
  }, [disabled, handleSend])

  return (
    <div className="px-3 sm:px-4 pb-3 sm:pb-4 flex-shrink-0 bg-background">
      <div className="border border-border rounded-lg transition-colors relative max-w-3xl mx-auto">
        <div className="h-[100px] sm:h-[130px] flex flex-col">
          <textarea
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={resolvedPlaceholder}
            disabled={disabled}
            className="flex-1 px-5 pt-4 text-sm resize-none outline-none bg-transparent w-full text-foreground placeholder:text-muted-foreground"
          />

          <div className="flex items-center justify-between px-4 pb-3 shrink-0">
            <div className="flex items-center gap-2">
              <button
                className="p-2.5 rounded-lg transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                title="上传图片"
              >
                <ImagePlus size={18} />
              </button>
            </div>

            <Button
              className={[
                'rounded-full w-11 h-11 p-0 flex items-center justify-center cursor-pointer',
                inputValue.trim() ? 'bg-primary text-primary-foreground' : 'bg-border text-muted-foreground',
              ].join(' ')}
              disabled={!inputValue.trim() || disabled}
              onClick={handleSend}
            >
              <ArrowUp size={16} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

