import type { ReactNode } from "react"

interface AuthShellProps {
  title: ReactNode
  description: ReactNode
  productLines: ReactNode[]
  heroFooter: ReactNode
  formEyebrow: ReactNode
  formDescription?: ReactNode
  formHeader?: ReactNode
  formFooter: ReactNode
  children: ReactNode
}

export function AuthShell({
  title,
  description,
  productLines,
  heroFooter,
  formEyebrow,
  formDescription,
  formHeader,
  formFooter,
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto grid min-h-dvh max-w-[84rem] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 xl:px-10">
        <div className="grid min-h-full w-full border border-border/80 bg-card shadow-token-lg xl:grid-cols-[minmax(300px,0.86fr)_minmax(0,1fr)]">
          <aside className="flex flex-col justify-between border-b border-border/80 bg-background px-5 py-5 sm:px-6 sm:py-6 xl:border-b-0 xl:border-r xl:px-8 xl:py-8">
            <div className="space-y-6">
              <div className="space-y-3.5 border-b border-border/70 pb-5">
                <p className="type-chat-kicker text-muted-foreground">aimoda</p>
                <img src="/aimoda-logo.svg" alt="aimoda" className="h-7 dark:hidden" />
                <img src="/aimoda-logo-inverted.svg" alt="aimoda" className="hidden h-7 dark:block" />
                <h1 className="type-page-title max-w-[12ch] text-balance text-foreground">{title}</h1>
                <p className="type-body-muted max-w-[32ch] text-pretty">{description}</p>
              </div>

              <div className="grid gap-0 border border-border/70">
                {productLines.map((item, index) => (
                  <div
                    key={typeof item === "string" ? item : index}
                    className={index < productLines.length - 1 ? "flex items-center justify-between gap-3 border-b border-border/70 px-3 py-3" : "flex items-center justify-between gap-3 px-3 py-3"}
                  >
                    <span className="type-chat-kicker text-muted-foreground">{item}</span>
                    <span className="type-chat-kicker tabular-nums text-foreground/88">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border/70 pt-5">
              <p className="type-chat-meta max-w-[30ch] text-pretty text-muted-foreground">{heroFooter}</p>
            </div>
          </aside>

          <section className="flex items-center px-5 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
            <div className="w-full max-w-[32rem] space-y-6">
              <div className="space-y-3.5 border-b border-border/70 pb-4">
                <p className="type-chat-kicker text-muted-foreground">{formEyebrow}</p>
                {formDescription ? <p className="type-chat-meta max-w-[40ch] text-pretty text-muted-foreground">{formDescription}</p> : null}
                {formHeader}
              </div>

              {children}

              <div className="border-t border-border/70 pt-3">
                <div className="type-chat-meta grid gap-3 text-pretty text-muted-foreground">{formFooter}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
