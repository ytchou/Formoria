import type { ReactNode } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveDashboardBrand } from '@/lib/services/resolve-dashboard-brand'
import { BrandSelector } from '@/components/dashboard/brand-selector'
import { DashboardTabNav } from '@/components/dashboard/dashboard-tab-nav'
import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { DashboardContentLayout } from '@/components/dashboard/dashboard-content-layout'
import { WelcomeBanner } from '@/components/dashboard/welcome-banner'
import { EditReviewBanner } from '@/components/brands/edit-review-banner'
import { getWelcomeBannerData } from './_lib/welcome-banner-data'
import { getLatestReview } from './_lib/latest-review'

type DashboardLayoutProps = {
  children: ReactNode
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

export default async function DashboardLayout({
  children,
  params,
  searchParams,
}: DashboardLayoutProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('dashboard.manage')
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const ctx = await resolveDashboardBrand(
    user.id,
    user.email ?? null,
    resolvedSearchParams.brand
  )

  if (!ctx) {
    return <DashboardEmptyState />
  }

  const { brand: selectedBrand, allBrands } = ctx

  const [welcomeBannerData, latestReview] = user
    ? await Promise.all([
        getWelcomeBannerData(selectedBrand),
        getLatestReview(selectedBrand, user),
      ])
    : [null, null]

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="flex h-[72px] items-center justify-between gap-6 px-5 lg:px-20">
          <BrandSelector
            brands={allBrands}
            selectedSlug={selectedBrand.brandSlug}
          />
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            href={`/dashboard/brands/${selectedBrand.brandSlug}/edit`}
          >
            {t('editButton')}
          </Link>
        </div>
      </header>

      <div className="border-b border-border bg-card [&_nav]:border-b-0">
        <div className="flex h-12 items-center px-5 lg:px-20">
          <DashboardTabNav brandSlug={selectedBrand.brandSlug} />
        </div>
      </div>

      <main className="px-5 py-8 lg:px-20">
        <DashboardContentLayout
          showOnboarding={Boolean(welcomeBannerData && !welcomeBannerData.isComplete)}
          onboarding={welcomeBannerData ? (
            <WelcomeBanner
              completedCount={welcomeBannerData.completedCount}
              nextStep={welcomeBannerData.nextStep}
              slug={selectedBrand.brandSlug}
              steps={welcomeBannerData.steps}
            />
          ) : null}
        >
          {latestReview ? (
            <EditReviewBanner
              edit={latestReview}
              brandSlug={selectedBrand.brandSlug}
            />
          ) : null}
          {children}
        </DashboardContentLayout>
      </main>
    </div>
  )
}
