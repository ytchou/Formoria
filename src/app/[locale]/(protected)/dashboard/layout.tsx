import type { ReactNode } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import * as brandOwners from '@/lib/services/brand-owners'
import type { OwnedBrand } from '@/lib/services/brand-owners'
import type { ActionNudge } from '@/lib/services/brand-health'
import type { PendingBrandEdit } from '@/lib/types/brand'
import { BrandSelector } from '@/components/dashboard/brand-selector'
import { DashboardTabNav } from '@/components/dashboard/dashboard-tab-nav'
import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { WelcomeBanner } from '@/components/dashboard/welcome-banner'
import { EditReviewBanner } from '@/components/brands/edit-review-banner'

type DashboardLayoutProps = {
  children: ReactNode
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

type User = {
  id: string
  email?: string | null
}

type WelcomeBannerData = {
  completionFraction: number
  topAction?: Pick<ActionNudge, 'labelKey' | 'anchor' | 'points'>
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function isWithinClaimWindow(claimedAt: string | null): boolean {
  if (claimedAt === null) return false

  const claimedAtTime = new Date(claimedAt).getTime()
  if (Number.isNaN(claimedAtTime)) return false

  return Date.now() - claimedAtTime <= SEVEN_DAYS_MS
}

async function getAdminBrand(
  requestedBrand: string,
  user: User
): Promise<OwnedBrand | null> {
  try {
    const { isActingAsAdmin } = await import('@/lib/auth/admin-mode')
    if (!(await isActingAsAdmin(user.email))) return null

    return await brandOwners.getBrandBySlugForAdmin(requestedBrand)
  } catch {
    return null
  }
}

async function getBrandsForUser(
  user: User | null,
  requestedBrand?: string
): Promise<OwnedBrand[]> {
  if (!user) return []

  const brands = await brandOwners.getUserBrands(user.id)
  let allBrands = brands

  if (
    requestedBrand &&
    !brands.some((brand) => brand.brandSlug === requestedBrand)
  ) {
    const godBrand = await getAdminBrand(requestedBrand, user)
    if (godBrand) allBrands = [godBrand, ...brands]
  }

  return allBrands
}

async function getWelcomeBannerData(
  selectedBrand: OwnedBrand
): Promise<WelcomeBannerData | null> {
  if (!isWithinClaimWindow(selectedBrand.claimedAt)) return null

  try {
    const [{ getBrandBySlug }, { getAnalytics }, { computeBrandCompleteness }, { computeBrandHealth }] =
      await Promise.all([
        import('@/lib/services/brands'),
        import('@/lib/services/brand-analytics'),
        import('@/lib/services/brand-completeness'),
        import('@/lib/services/brand-health'),
      ])
    const brand = await getBrandBySlug(selectedBrand.brandSlug)
    const analytics = await getAnalytics(brand.id, 30).catch(() => null)
    const completeness = computeBrandCompleteness(brand)
    const health = computeBrandHealth(brand, analytics, new Date(brand.createdAt))

    return {
      completionFraction: completeness.fraction,
      topAction: health.topActions[0],
    }
  } catch {
    return null
  }
}

async function getLatestReview(
  selectedBrand: OwnedBrand,
  user: User
): Promise<PendingBrandEdit | null> {
  try {
    const { getLatestEditReview } = await import('@/lib/services/pending-edits')
    return await getLatestEditReview(selectedBrand.brandId, user.id)
  } catch {
    return null
  }
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

  const currentUser = user ? { id: user.id, email: user.email } : null
  const brands = await getBrandsForUser(currentUser, resolvedSearchParams.brand)
  const selectedBrand =
    brands.find((brand) => brand.brandSlug === resolvedSearchParams.brand) ??
    brands[0]

  if (!selectedBrand) {
    return <DashboardEmptyState />
  }

  const [welcomeBannerData, latestReview] = currentUser
    ? await Promise.all([
        getWelcomeBannerData(selectedBrand),
        getLatestReview(selectedBrand, currentUser),
      ])
    : [null, null]

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="flex h-[72px] items-center justify-between gap-6 px-5 lg:px-20">
          <BrandSelector
            brands={brands}
            selectedSlug={selectedBrand.brandSlug}
          />
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-[8px] border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
        <div className="space-y-6">
          {welcomeBannerData ? (
            <WelcomeBanner
              claimedAt={selectedBrand.claimedAt}
              completionFraction={welcomeBannerData.completionFraction}
              slug={selectedBrand.brandSlug}
              topAction={welcomeBannerData.topAction}
            />
          ) : null}
          {latestReview ? (
            <EditReviewBanner
              edit={latestReview}
              brandSlug={selectedBrand.brandSlug}
            />
          ) : null}
          {children}
        </div>
      </main>
    </div>
  )
}
