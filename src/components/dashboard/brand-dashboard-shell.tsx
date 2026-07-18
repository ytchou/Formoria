import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { DashboardTabNav } from './dashboard-tab-nav'

type BrandDashboardShellProps = {
  brandName: string
  brandSlug: string
  children: ReactNode
}

export async function BrandDashboardShell({
  brandName,
  brandSlug,
  children,
}: BrandDashboardShellProps) {
  const t = await getTranslations('dashboard.manage')

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 type-section-title-large">
            {brandName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className={buttonVariants({
                variant: 'secondary',
              })}
              href={`/brands/${brandSlug}`}
            >
              {t('viewButton')}
            </Link>
            <Link
              className={buttonVariants({ variant: 'primary' })}
              href={`/dashboard/brands/${brandSlug}/edit`}
            >
              {t('editButton')}
            </Link>
          </div>
        </div>

        <DashboardTabNav brandSlug={brandSlug} />
      </div>

      {children}
    </section>
  )
}
