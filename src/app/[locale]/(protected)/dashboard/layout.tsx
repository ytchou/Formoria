import type { ReactNode } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveDashboardBrand } from '@/lib/services/resolve-dashboard-brand'
import { DashboardTabNav } from '@/components/dashboard/dashboard-tab-nav'
import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { EditReviewBanner } from '@/components/brands/edit-review-banner'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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

  const { brand: selectedBrand } = ctx

  const latestReview = await getLatestReview(selectedBrand, user)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex min-h-16 max-w-screen-xl flex-wrap items-center justify-between gap-3 px-6 py-2">
          <h1 className="font-heading text-[22px] font-bold leading-tight text-foreground">
            {selectedBrand.brandName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className={cn(buttonVariants({ variant: 'outline' }), 'min-h-12 rounded-full px-5')}
              href={`/brands/${selectedBrand.brandSlug}`}
            >
              {t('viewButton')}
            </Link>
            <Link
              className={cn(buttonVariants(), 'min-h-12 rounded-full px-5')}
              href={`/dashboard/brands/${selectedBrand.brandSlug}/edit`}
            >
              {t('editButton')}
            </Link>
          </div>
        </div>
      </header>

      <div className="border-b border-border bg-background [&_nav]:border-b-0">
        <div className="mx-auto flex h-12 max-w-screen-xl items-center px-6">
          <DashboardTabNav brandSlug={selectedBrand.brandSlug} />
        </div>
      </div>

      <main className="mx-auto max-w-screen-xl px-6 py-8">
        <div className="space-y-6">
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
