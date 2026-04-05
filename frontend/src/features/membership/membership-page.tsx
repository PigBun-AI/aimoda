import { MembershipOverview } from '@/features/membership/membership-overview'

export function MembershipPage() {
  return (
    <section className="space-y-8 overflow-y-auto bg-background px-4 py-6 sm:px-6 lg:px-8">
      <MembershipOverview />
    </section>
  )
}
