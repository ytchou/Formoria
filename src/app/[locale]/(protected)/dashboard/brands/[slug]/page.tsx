import { setRequestLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandBySlug } from '@/lib/services/brands'
import { computeProfileCompleteness } from '@/lib/services/profile-completeness'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { ProfileCompletenessCard } from '@/components/dashboard/profile-completeness-card'
import { InlineVerification } from '@/components/dashboard/inline-verification'
import { OwnerBrandOverview } from '@/components/dashboard/owner-brand-overview'
import { DashboardContentLayout } from '@/components/dashboard/dashboard-content-layout'
import { WelcomeBanner } from '@/components/dashboard/welcome-banner'
import { getBrandOnboardingProgress } from '@/lib/services/brand-onboarding'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

export default async function BrandOverviewPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const brand = await getBrandBySlug(slug)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [ownerCheck, walkthrough] = await Promise.all([
    user ? isOwnerOf(user.id, brand.id) : Promise.resolve(false),
    getBrandOnboardingProgress(brand.id),
  ])
  const completeness = computeProfileCompleteness(brand)

  const content = (
    <div className="w-full space-y-8" data-testid="brand-profile">
      <div className="space-y-8">
        <InlineVerification
          brandId={brand.id}
          brandName={brand.name}
          brandSlug={brand.slug}
          mitStatus={brand.mitStatus ?? 'unverified'}
          mitEvidence={brand.mitEvidence ?? undefined}
          isOwner={ownerCheck}
        />

        <ProfileCompletenessCard completeness={completeness} slug={slug} />
        <OwnerBrandOverview brand={brand} />
      </div>
    </div>
  )

  return (
    <DashboardContentLayout
      showOnboarding={ownerCheck && !walkthrough.isComplete}
      onboarding={ownerCheck ? (
        <WelcomeBanner
          brandId={brand.id}
          completedCount={walkthrough.completedCount}
          nextStep={walkthrough.nextStep}
          slug={brand.slug}
          steps={walkthrough.steps}
        />
      ) : null}
    >
      {content}
    </DashboardContentLayout>
  )
}
