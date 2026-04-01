import { useState, useCallback, useRef } from 'react'
import { ImagePlus, ArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatComposerInput, ContentBlock, ImageSourceBase64 } from './chat-types'

interface ChatInputProps {
  onSend?: (input: ChatComposerInput) => void
  placeholder?: string
  disabled?: boolean
}

interface PendingImage {
  id: string
  fileName: string
  mimeType: string
  source: ImageSourceBase64
}

const MAX_IMAGE_SIZE_MB = 5

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function ChatInput({
  onSend,
  placeholder,
  disabled = false,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const resolvedPlaceholder = placeholder ?? '输入搜索需求，如「找红色连衣裙」「风衣搭配短裙」...'

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim()
    if ((!trimmed && pendingImages.length === 0) || disabled) return

    const content: ContentBlock[] = []
    for (const image of pendingImages) {
      content.push({
        type: 'image',
        source: image.source,
        mime_type: image.mimeType,
        file_name: image.fileName,
      })
    }
    if (trimmed) {
      content.push({ type: 'text', text: trimmed })
    }

    onSend?.({ content })
    setInputValue('')
    setPendingImages([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [disabled, inputValue, onSend, pendingImages])

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled) {
      e.preventDefault()
      handleSend()
    }
  }, [disabled, handleSend])

  const handlePickImages = useCallback(() => {
    if (disabled) return
    fileInputRef.current?.click()
  }, [disabled])

  const handleFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const nextImages: PendingImage[] = []
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) continue

      const dataUrl = await readFileAsDataUrl(file)
      const matched = dataUrl.match(/^data:(.*?);base64,(.*)$/)
      if (!matched) continue

      nextImages.push({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        fileName: file.name,
        mimeType: matched[1],
        source: {
          type: 'base64',
          media_type: matched[1],
          data: matched[2],
        },
      })
    }

    if (nextImages.length > 0) {
      setPendingImages(current => [...current, ...nextImages])
    }

    e.target.value = ''
  }, [])

  const removePendingImage = useCallback((id: string) => {
    setPendingImages(current => current.filter(image => image.id !== id))
  }, [])

  const canSend = (inputValue.trim().length > 0 || pendingImages.length > 0) && !disabled

  return (
    <div className="px-3 sm:px-4 pb-3 sm:pb-4 flex-shrink-0 bg-background">
      <div className="border border-border rounded-lg transition-colors relative max-w-3xl mx-auto">
        <div className="flex flex-col">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleFilesSelected}
          />
          {pendingImages.length > 0 && (
            <div className="flex gap-2 px-4 pt-4 overflow-x-auto">
              {pendingImages.map(image => (
                <div key={image.id} className="relative shrink-0">
                  <img
                    src={`data:${image.source.media_type};base64,${image.source.data}`}
                    alt={image.fileName}
                    className="h-16 w-16 object-cover rounded-lg border border-border bg-muted"
                  />
                  <button
                    type="button"
                    onClick={() => removePendingImage(image.id)}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={`移除 ${image.fileName}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
                type="button"
                onClick={handlePickImages}
                className="p-2.5 rounded-lg transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                title="上传图片"
              >
                <ImagePlus size={18} />
              </button>
            </div>

            <Button
              className={[
                'rounded-full w-11 h-11 p-0 flex items-center justify-center cursor-pointer',
                canSend ? 'bg-primary text-primary-foreground' : 'bg-border text-muted-foreground',
              ].join(' ')}
              disabled={!canSend}
              onClick={handleSend}
            >
              <ArrowUp size={16} />
            </Button>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
