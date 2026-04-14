import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface SectionIntroProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
  variant?: "compact" | "editorial"
  className?: string
  titleClassName?: string
  descriptionClassName?: string
}

export function SectionIntro({
  eyebrow,
  title,
  description,
  aside,
  variant = "compact",
  className,
  titleClassName,
  descriptionClassName,
}: SectionIntroProps) {
  return (
    <header
      className={cn(
        variant === "editorial"
          ? "grid gap-5 border-t border-border/70 pt-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(15rem,0.78fr)] xl:gap-7 xl:pt-6"
          : "grid gap-4 border-t border-border/70 pt-4 xl:grid-cols-[minmax(0,1.38fr)_minmax(14rem,0.8fr)] xl:gap-6 xl:pt-5",
        className,
      )}
    >
      <div className={cn(variant === "editorial" ? "space-y-3" : "space-y-2.5")}>
        {eyebrow ? <div className="type-chat-kicker text-muted-foreground tabular-nums">{eyebrow}</div> : null}
        <div className={cn(variant === "editorial" ? "type-section-title max-w-[16ch] text-balance text-foreground" : "type-section-title max-w-[18ch] text-balance text-foreground", titleClassName)}>{title}</div>
        {description ? (
          <div className={cn(variant === "editorial" ? "type-body-muted max-w-[44ch] text-pretty" : "type-body-muted max-w-[40ch] text-pretty", descriptionClassName)}>{description}</div>
        ) : null}
      </div>

      {aside ? (
        <div className={cn(
          "border border-border/60 bg-card shadow-token-sm",
          variant === "editorial" ? "px-5 py-5" : "px-4 py-4 sm:px-5 sm:py-5",
        )}>
          {aside}
        </div>
      ) : null}
    </header>
  )
}
