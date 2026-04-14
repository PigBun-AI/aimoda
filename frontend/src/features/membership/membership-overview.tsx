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
  const cardTitleClass = compact ? 'type-ed-title-sm max-w-[16ch] text-foreground' : 'type-editorial-inline max-w-[16ch] text-foreground'
  const summaryClass = compact ? 'type-ed-title-sm text-foreground' : 'type-editorial-inline text-foreground'
  const conciergeTitleClass = compact ? 'type-ed-title-sm text-foreground' : 'type-editorial-inline text-foreground'

  return (
    <div className={compact ? 'space-y-5' : 'space-y-6'}>
      {showHeader && (
        <header className="grid gap-4 border-t border-border pt-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.76fr)] xl:gap-6 xl:pt-5">
          <div className="space-y-3">
            <p className="type-kicker-wide text-muted-foreground">
              {t('membership.navLabel')}
            </p>
            <h1 className="type-page-title max-w-[12ch] text-foreground">
              {t('membership.centerTitle')}
            </h1>
            <p className="type-body-muted max-w-[42ch]">
              {t('membership.centerSubtitle')}
            </p>
          </div>

          <div className="flex flex-col justify-between gap-3 border-t border-border pt-3 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
            <div className="type-meta space-y-3 text-muted-foreground">
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(260px,0.68fr)]">
        <div className="flex flex-col gap-5">
          <article className={compact ? 'border border-border bg-card p-5' : 'border border-border bg-card p-4 sm:p-5'}>
            <div className={compact ? 'flex flex-col gap-5 border-b border-border pb-5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end' : 'flex flex-col gap-5 border-b border-border pb-6 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end'}>
              <div className="space-y-3">
                <p className="type-kicker-wide text-muted-foreground">
                  {t('membership.aiCardEyebrow')}
                </p>
                <h2 className={cardTitleClass}>
                  {t('membership.aiCardTitle')}
                </h2>
              </div>
              <span className="type-kicker text-muted-foreground">
                {aiQuotaLabel}
              </span>
            </div>

            <div className="grid gap-4 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-3">
                <p className={summaryClass}>
                  {aiSummary}
                </p>
                <p className="type-body-muted max-w-[52ch]">
                  {planDetail}
                </p>
                <p className="type-body-muted max-w-[52ch]">
                  {t('membership.aiCardBody')}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="ghost" className="h-10 px-4">
                  <Link to="/chat">{t('membership.openAssistant')}</Link>
                </Button>
                {!compact && <RedeemDialog />}
              </div>
            </div>
          </article>

          <article className={compact ? 'border border-border bg-card p-5' : 'border border-border bg-card p-4 sm:p-5'}>
            <div className={compact ? 'flex flex-col gap-5 border-b border-border pb-5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end' : 'flex flex-col gap-5 border-b border-border pb-6 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end'}>
              <div className="space-y-3">
                <p className="type-kicker-wide text-muted-foreground">
                  {t('membership.reportsCardEyebrow')}
                </p>
                <h2 className={cardTitleClass}>
                  {hasSubscription ? t('membership.reportsUnlockedTitle') : t('membership.reportsLockedTitle')}
                </h2>
              </div>
              <span className="type-kicker text-muted-foreground">
                {hasSubscription ? t('membership.reportsUnlocked') : t('membership.reportsLocked')}
              </span>
            </div>

            <div className="grid gap-4 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-3">
                <p className={summaryClass}>
                  {reportsSummary}
                </p>
                <p className="type-body-muted max-w-[52ch]">
                  {t('membership.reportsCardBody')}
                </p>
              </div>
              <Button asChild variant="outline" className="h-10 px-4">
                <Link to="/reports">{t('membership.viewReports')}</Link>
              </Button>
            </div>
          </article>
        </div>

        <div className="space-y-6">
          <MembershipCard showActions={!compact} />

          <div className={compact ? 'border border-border bg-card p-5 text-sm text-muted-foreground' : 'border border-border bg-card p-4 text-sm text-muted-foreground sm:p-5'}>
            <div className="space-y-3 border-b border-border pb-5">
              <p className="type-kicker-wide text-muted-foreground">
                {t('membership.conciergeEyebrow')}
              </p>
              <p className={conciergeTitleClass}>
                {t('membership.conciergeTitle')}
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <p className="type-body-muted max-w-[30ch]">
                {t('membership.conciergeBody')}
              </p>
              <WechatQrCode size={132} />
            </div>
            <div className="mt-4">
              <RedeemDialog />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
