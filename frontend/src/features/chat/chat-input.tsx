import { type ReactNode, useCallback, useMemo, useRef, useState } from "react"
import { ArrowUp, ImagePlus, Square, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

import type { ChatComposerInput, ContentBlock, ImageSourceBase64 } from "./chat-types"

interface ChatInputProps {
  onSend?: (input: ChatComposerInput) => void
  onStop?: () => void
  placeholder?: string
  disabled?: boolean
  isRunning?: boolean
  isStopping?: boolean
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

async function buildPendingImages(files: File[]) {
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

  return nextImages
}

export function ChatInput({
  onSend,
  onStop,
  placeholder,
  disabled = false,
  isRunning = false,
  isStopping = false,
  infoMessage,
  statusBar,
}: ChatInputProps) {
  const { t } = useTranslation("common")
  const [inputValue, setInputValue] = useState("")
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
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

  const appendPendingImages = useCallback((images: PendingImage[]) => {
    if (images.length === 0) return
    setPendingImages(current => {
      const known = new Set(current.map(image => image.id))
      const deduped = images.filter(image => !known.has(image.id))
      return deduped.length > 0 ? [...current, ...deduped] : current
    })
  }, [])

  const handleFilesSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    const nextImages = await buildPendingImages(files)
    appendPendingImages(nextImages)

    event.target.value = ""
  }, [appendPendingImages])

  const removePendingImage = useCallback((id: string) => {
    setPendingImages(current => current.filter(image => image.id !== id))
  }, [])

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (disabled || !Array.from(event.dataTransfer.items).some(item => item.type.startsWith("image/"))) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragActive(true)
  }, [disabled])

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return
    if (!Array.from(event.dataTransfer.items).some(item => item.type.startsWith("image/"))) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [disabled])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }, [disabled])

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragActive(false)

    const files = Array.from(event.dataTransfer.files || [])
    if (files.length === 0) return

    const nextImages = await buildPendingImages(files)
    appendPendingImages(nextImages)
  }, [appendPendingImages, disabled])

  const canSend = (inputValue.trim().length > 0 || pendingImages.length > 0) && !disabled
  const dragHint = useMemo(
    () => pendingImages.length > 0 ? t("dragImageReplaceHint") : t("dragImageHint"),
    [pendingImages.length, t],
  )

  return (
    <div className="bg-background px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto max-w-3xl">
        <div
          className={[
            "relative overflow-hidden border bg-background transition-colors",
            isDragActive ? "border-foreground" : "border-border",
          ].join(" ")}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragActive && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/94">
              <div className="flex flex-col items-center gap-3 border border-foreground px-6 py-6 text-center">
                <ImagePlus size={20} className="text-foreground" />
                <div className="space-y-1">
                  <p className="type-chat-kicker text-foreground">{t("dropImageHere")}</p>
                  <p className="type-chat-meta text-muted-foreground">{t("dropImageHint")}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={handleFilesSelected}
            />

            {(statusBar || infoMessage) && (
              <div className="border-b border-border/80 bg-muted/[0.14] px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-2.5">
                  {statusBar && <div className="min-w-0">{statusBar}</div>}
                  {infoMessage && (
                    <p className="type-chat-meta text-muted-foreground/88">
                      {infoMessage}
                    </p>
                  )}
                  {!infoMessage && (
                    <p className="type-chat-meta text-muted-foreground/72">
                      {dragHint}
                    </p>
                  )}
                </div>
              </div>
            )}

            {pendingImages.length > 0 && (
              <div className="flex gap-2 overflow-x-auto px-4 pt-4 sm:px-5">
                {pendingImages.map(image => (
                  <div key={image.id} className="relative shrink-0">
                    <img
                      src={`data:${image.source.media_type};base64,${image.source.data}`}
                      alt={image.fileName}
                      className="h-16 w-16 border border-border bg-muted object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePendingImage(image.id)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center border border-border bg-background text-muted-foreground hover:text-foreground"
                      aria-label={t("removeImage", { fileName: image.fileName })}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex min-h-[118px] flex-col sm:min-h-[138px]">
              <textarea
                value={inputValue}
                onChange={event => setInputValue(event.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={resolvedPlaceholder}
                disabled={disabled}
                className="type-chat-body min-h-[76px] flex-1 w-full resize-none bg-transparent px-4 pt-4 text-foreground outline-none placeholder:text-muted-foreground/72 sm:px-5"
              />

              <div className="flex shrink-0 items-center justify-between border-t border-border/70 bg-background px-3 pb-3 pt-2 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePickImages}
                    className="control-icon-sm shrink-0 cursor-pointer border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                    title={t("uploadImage")}
                  >
                    <ImagePlus size={18} />
                  </button>
                  <span className="type-chat-meta hidden truncate text-muted-foreground/72 sm:inline">
                    {dragHint}
                  </span>
                </div>

                {isRunning ? (
                  <Button
                    type="button"
                    className={[
                      "flex h-11 min-w-[92px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-none border border-foreground bg-background px-4 text-foreground",
                      "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-55",
                    ].join(" ")}
                    disabled={isStopping}
                    onClick={onStop}
                  >
                    <Square size={14} fill="currentColor" />
                    <span className="type-chat-action">{isStopping ? t("stoppingAgent") : t("stopAgent")}</span>
                  </Button>
                ) : (
                  <Button
                    className={[
                      "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-none p-0",
                      canSend ? "bg-foreground text-background hover:bg-foreground/88" : "bg-border text-muted-foreground",
                    ].join(" ")}
                    disabled={!canSend}
                    onClick={handleSend}
                  >
                    <ArrowUp size={16} />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
