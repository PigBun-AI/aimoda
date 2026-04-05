import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useMembershipStatus } from '@/features/membership/use-membership'
import { Button } from '@/components/ui/button'

interface MembershipCardProps {
  showActions?: boolean
}

export function MembershipCard({ showActions = true }: MembershipCardProps) {
  const { t } = useTranslation('common')
  const {
    planLabel,
    planBadgeLabel,
    planDetail,
    aiSummary,
    aiQuotaLabel,
  } = useMembershipStatus()

  return (
    <div className="flex w-full flex-col gap-4 border border-border bg-card p-4 text-sm text-muted-foreground">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">
            {t('membership.cardEyebrow')}
          </p>
          <p className="font-serif text-[1.18rem] leading-none tracking-[-0.03em] text-foreground">
            {planLabel}
          </p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {planBadgeLabel}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <span>{t('aiAssistant')}</span>
          <span>{aiQuotaLabel}</span>
        </div>
        <p className="font-serif text-[1rem] leading-[1.15] text-foreground">
          {aiSummary}
        </p>
        <p className="text-[11px] leading-5 text-muted-foreground/85">
          {planDetail}
        </p>
      </div>

      {showActions && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button variant="ghost" className="h-9 px-3 text-[10px] font-semibold uppercase tracking-[0.16em]" asChild>
            <Link to="/profile?tab=access">{t('membership.openCenter')}</Link>
          </Button>
          <Link
            to="/chat"
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground transition-colors hover:text-muted-foreground"
          >
            {t('membership.openAssistant')}
          </Link>
        </div>
      )}
    </div>
  )
}
