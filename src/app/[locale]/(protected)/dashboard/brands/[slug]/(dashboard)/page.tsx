import { revalidatePath } from 'next/cache'
import { setRequestLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandBySlug, dismissOnboardingWelcome } from '@/lib/services/brands'
import { computeProfileCompleteness } from '@/lib/services/profile-completeness'
import { canManageDashboardBrand } from '@/lib/auth/admin-mode'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { getPostHogOwnerAnalyticsSnapshot } from '@/lib/services/posthog-owner-analytics'
import { DashboardHeroCard } from '@/components/dashboard/dashboard-hero-card'
import { SectionSummaryCards } from '@/components/dashboard/section-summary-cards'
import { CompletionRail } from '@/components/dashboard/completion-rail'
import { OverviewInlineAnalytics } from '@/components/dashboard/overview-inline-analytics'
import { WelcomeBanner } from '@/components/dashboard/welcome-banner'

type Props = {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function BrandOverviewPage({ params, searchParams }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const sp = await searchParams
  const periodRaw = typeof sp.period === 'string' ? parseInt(sp.period, 10) : 30
  const period = [7, 30, 90].includes(periodRaw) ? (periodRaw as 7 | 30 | 90) : 30

  const brand = await getBrandBySlug(slug)
  const completeness = computeProfileCompleteness(brand)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ownerCheck = user ? await canManageDashboardBrand(user.id, user.email, brand.id, slug) : false

  const [analytics] = await Promise.all([
    getPostHogOwnerAnalyticsSnapshot(brand.id, { daysBack: period }).catch(() => null),
  ])

  async function dismissWelcome() {
    'use server'
    const editor = await requireBrandEditor(slug)
    if ('error' in editor) return
    await dismissOnboardingWelcome(editor.brand.id)
    revalidatePath(`/dashboard/brands/${slug}`)
  }

  return (
    <div className="flex flex-col md:flex-row gap-6" data-testid="brand-profile">
      <main className="flex-1 min-w-0 space-y-6">
        {ownerCheck && !brand.onboardingDismissedAt ? (
          <WelcomeBanner brandSlug={slug} dismissAction={dismissWelcome} />
        ) : null}
        <DashboardHeroCard brand={brand} completenessScore={completeness.score} />
        <SectionSummaryCards brand={brand} slug={slug} />
        <OverviewInlineAnalytics snapshot={analytics} period={period} />
      </main>
      <aside className="w-full md:w-72 shrink-0">
        <CompletionRail completeness={completeness} slug={slug} mitStatus={brand.mitStatus ?? 'unverified'} />
      </aside>
    </div>
  )
}
