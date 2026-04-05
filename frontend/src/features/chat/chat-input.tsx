import { type ReactNode, useCallback, useRef, useState } from "react"
import { ArrowUp, ImagePlus, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

import type { ChatComposerInput, ContentBlock, ImageSourceBase64 } from "./chat-types"

interface ChatInputProps {
  onSend?: (input: ChatComposerInput) => void
  placeholder?: string
  disabled?: boolean
  infoMessage?: string
  statusBar?: ReactNode
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
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

export function ChatInput({
  onSend,
  placeholder,
  disabled = false,
  infoMessage,
  statusBar,
}: ChatInputProps) {
  const { t } = useTranslation("common")
  const [inputValue, setInputValue] = useState("")
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const resolvedPlaceholder = placeholder ?? t("chatInputPlaceholder")

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim()
    if ((!trimmed && pendingImages.length === 0) || disabled) return

    const content: ContentBlock[] = []
    for (const image of pendingImages) {
      content.push({
        type: "image",
        source: image.source,
        mime_type: image.mimeType,
        file_name: image.fileName,
      })
    }
    if (trimmed) {
      content.push({ type: "text", text: trimmed })
    }

    onSend?.({ content })
    setInputValue("")
    setPendingImages([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [disabled, inputValue, onSend, pendingImages])

  const handleKeyPress = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !disabled) {
      event.preventDefault()
      handleSend()
    }
  }, [disabled, handleSend])

  const handlePickImages = useCallback(() => {
    if (disabled) return
    fileInputRef.current?.click()
  }, [disabled])

  const handleFilesSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    const nextImages: PendingImage[] = []
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue
      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) continue

      const dataUrl = await readFileAsDataUrl(file)
      const matched = dataUrl.match(/^data:(.*?);base64,(.*)$/)
      if (!matched) continue

      nextImages.push({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        fileName: file.name,
        mimeType: matched[1],
        source: {
          type: "base64",
          media_type: matched[1],
          data: matched[2],
        },
      })
    }

    if (nextImages.length > 0) {
      setPendingImages(current => [...current, ...nextImages])
    }

    event.target.value = ""
  }, [])

  const removePendingImage = useCallback((id: string) => {
    setPendingImages(current => current.filter(image => image.id !== id))
  }, [])

  const canSend = (inputValue.trim().length > 0 || pendingImages.length > 0) && !disabled

  return (
    <div className="bg-background px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {(statusBar || infoMessage) && (
          <div className="border border-border/80 bg-muted/16 px-4 py-3">
            <div className="flex flex-col gap-2">
              {statusBar && <div className="min-w-0">{statusBar}</div>}
              {infoMessage && (
                <p className="type-ui-meta text-muted-foreground/88">
                  {infoMessage}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="relative rounded-lg border border-border bg-background transition-colors">
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
              <div className="flex gap-2 overflow-x-auto px-4 pt-4">
                {pendingImages.map(image => (
                  <div key={image.id} className="relative shrink-0">
                    <img
                      src={`data:${image.source.media_type};base64,${image.source.data}`}
                      alt={image.fileName}
                      className="h-16 w-16 rounded-lg border border-border bg-muted object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePendingImage(image.id)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
                      aria-label={t("removeImage", { fileName: image.fileName })}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex h-[100px] flex-col sm:h-[130px]">
              <textarea
                value={inputValue}
                onChange={event => setInputValue(event.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={resolvedPlaceholder}
                disabled={disabled}
                className="flex-1 w-full resize-none bg-transparent px-5 pt-4 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />

              <div className="flex items-center justify-between px-4 pb-3 pt-2 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePickImages}
                    className="shrink-0 cursor-pointer rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                    title={t("uploadImage")}
                  >
                    <ImagePlus size={18} />
                  </button>
                </div>

                <Button
                  className={[
                    "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full p-0",
                    canSend ? "bg-foreground text-background hover:bg-foreground/88" : "bg-border text-muted-foreground",
                  ].join(" ")}
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
    </div>
  )
}
