import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { WechatQrCode } from '@/components/support/wechat-qr-code'
import { Button } from '@/components/ui/button'
import { MembershipCard } from '@/features/membership/membership-card'
import { useMembershipStatus } from '@/features/membership/use-membership'
import { RedeemDialog } from '@/features/redemption/redeem-dialog'

interface MembershipOverviewProps {
  showHeader?: boolean
  compact?: boolean
}

export function MembershipOverview({ showHeader = true, compact = false }: MembershipOverviewProps) {
  const { t } = useTranslation('common')
  const {
    planLabel,
    aiQuotaLabel,
    planDetail,
    aiSummary,
    reportsSummary,
    hasSubscription,
  } = useMembershipStatus()

  return (
    <div className={compact ? 'space-y-6' : 'space-y-8'}>
      {showHeader && (
        <header className="grid gap-6 border-t border-border pt-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(240px,0.75fr)] lg:gap-8 lg:pt-6">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t('membership.navLabel')}
            </p>
            <h1 className="max-w-[12ch] font-serif text-[2.3rem] font-medium leading-[0.96] tracking-[-0.045em] text-foreground sm:text-[3.2rem]">
              {t('membership.centerTitle')}
            </h1>
            <p className="max-w-[42ch] text-[11px] uppercase leading-5 tracking-[0.14em] text-muted-foreground">
              {t('membership.centerSubtitle')}
            </p>
          </div>

          <div className="flex flex-col justify-between gap-4 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="space-y-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border pb-3 sm:flex-row sm:items-center sm:gap-4">
                <span>{t('membership.currentPlan')}</span>
                <span className="text-foreground">{planLabel}</span>
              </div>
              <div className="flex flex-col items-start justify-between gap-1.5 border-b border-border pb-3 sm:flex-row sm:items-center sm:gap-4">
                <span>{t('membership.currentQuota')}</span>
                <span className="text-foreground">{aiQuotaLabel}</span>
              </div>
              <div className="flex flex-col items-start justify-between gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                <span>{t('membership.reportAccess')}</span>
                <span className="text-foreground">
                  {hasSubscription ? t('membership.reportsUnlocked') : t('membership.reportsLocked')}
                </span>
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.65fr)]">
        <div className="flex flex-col gap-6">
          <article className={compact ? 'border border-border bg-card p-5' : 'border border-border bg-card p-5 sm:p-6'}>
            <div className={compact ? 'flex flex-col gap-5 border-b border-border pb-5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end' : 'flex flex-col gap-6 border-b border-border pb-6 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end'}>
              <div className="space-y-3">
                <p className="text-[9px] uppercase tracking-[0.24em] text-muted-foreground">
                  {t('membership.aiCardEyebrow')}
                </p>
                <h2 className={compact ? 'max-w-[16ch] font-serif text-[1.55rem] leading-[0.98] tracking-[-0.035em] text-foreground sm:text-[1.9rem]' : 'max-w-[16ch] font-serif text-[1.85rem] leading-[0.96] tracking-[-0.04em] text-foreground sm:text-[2.3rem]'}>
                  {t('membership.aiCardTitle')}
                </h2>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {aiQuotaLabel}
              </span>
            </div>

            <div className="grid gap-5 pt-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-3">
                <p className="font-serif text-[1.1rem] leading-[1.1] text-foreground">
                  {aiSummary}
                </p>
                <p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">
                  {planDetail}
                </p>
                <p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">
                  {t('membership.aiCardBody')}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="ghost" className="h-10 px-4 text-[10px] font-semibold uppercase tracking-[0.14em]">
                  <Link to="/chat">{t('membership.openAssistant')}</Link>
                </Button>
                {!compact && <RedeemDialog />}
              </div>
            </div>
          </article>

          <article className={compact ? 'border border-border bg-card p-5' : 'border border-border bg-card p-5 sm:p-6'}>
            <div className={compact ? 'flex flex-col gap-5 border-b border-border pb-5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end' : 'flex flex-col gap-6 border-b border-border pb-6 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end'}>
              <div className="space-y-3">
                <p className="text-[9px] uppercase tracking-[0.24em] text-muted-foreground">
                  {t('membership.reportsCardEyebrow')}
                </p>
                <h2 className={compact ? 'max-w-[16ch] font-serif text-[1.55rem] leading-[0.98] tracking-[-0.035em] text-foreground sm:text-[1.9rem]' : 'max-w-[16ch] font-serif text-[1.85rem] leading-[0.96] tracking-[-0.04em] text-foreground sm:text-[2.3rem]'}>
                  {hasSubscription ? t('membership.reportsUnlockedTitle') : t('membership.reportsLockedTitle')}
                </h2>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {hasSubscription ? t('membership.reportsUnlocked') : t('membership.reportsLocked')}
              </span>
            </div>

            <div className="grid gap-5 pt-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-3">
                <p className="font-serif text-[1.1rem] leading-[1.1] text-foreground">
                  {reportsSummary}
                </p>
                <p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">
                  {t('membership.reportsCardBody')}
                </p>
              </div>
              <Button asChild variant="outline" className="h-10 px-4 text-[10px] font-semibold uppercase tracking-[0.14em]">
                <Link to="/reports">{t('membership.viewReports')}</Link>
              </Button>
            </div>
          </article>
        </div>

        <div className="space-y-6">
          <MembershipCard showActions={!compact} />

          <div className={compact ? 'border border-border bg-card p-5 text-sm text-muted-foreground' : 'border border-border bg-card p-5 text-sm text-muted-foreground sm:p-6'}>
            <div className="space-y-3 border-b border-border pb-5">
              <p className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                {t('membership.conciergeEyebrow')}
              </p>
              <p className={compact ? 'font-serif text-[1.25rem] leading-[1.02] tracking-[-0.03em] text-foreground' : 'font-serif text-[1.45rem] leading-[0.98] tracking-[-0.03em] text-foreground'}>
                {t('membership.conciergeTitle')}
              </p>
            </div>
            <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <p className="max-w-[30ch] text-sm leading-6 text-muted-foreground">
                {t('membership.conciergeBody')}
              </p>
              <WechatQrCode size={132} />
            </div>
            <div className="mt-5">
              <RedeemDialog />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
