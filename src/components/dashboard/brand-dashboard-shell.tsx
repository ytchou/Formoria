import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { EditReviewBanner } from '@/components/brands/edit-review-banner'
import { buttonVariants } from '@/components/ui/button'
import { DashboardTabNav } from './dashboard-tab-nav'
import type { PendingBrandEdit } from '@/lib/types/brand'

type BrandDashboardShellProps = {
  brandName: string
  brandSlug: string
  latestReview?: PendingBrandEdit | null
  children: ReactNode
}

export async function BrandDashboardShell({
  brandName,
  brandSlug,
  latestReview = null,
  children,
}: BrandDashboardShellProps) {
  const t = await getTranslations('dashboard.manage')

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 font-heading text-2xl font-bold tracking-tight text-foreground">
            {brandName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className={buttonVariants({
                variant: 'outline',
                className: 'min-h-12',
              })}
              href={`/brands/${brandSlug}`}
            >
              {t('viewButton')}
            </Link>
            <Link
              className={buttonVariants({ className: 'min-h-12' })}
              href={`/dashboard/brands/${brandSlug}/edit`}
            >
              {t('editButton')}
            </Link>
          </div>
        </div>

        <DashboardTabNav brandSlug={brandSlug} />
      </div>

      {latestReview ? (
        <EditReviewBanner edit={latestReview} brandSlug={brandSlug} />
      ) : null}

      {children}
    </section>
  )
}
