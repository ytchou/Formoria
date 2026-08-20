'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { PageShell } from '@/components/ui/page-shell'
import { routes } from '@/lib/routes'

export default function BrandNotFound() {
  const t = useTranslations('brandDetail')

  return (
    // `prose`, as at every error boundary: a centred message reads at the
    // reading measure, not across the full discovery width.
    <PageShell
      as="main"
      measure="prose"
      className="flex flex-col items-center justify-center py-24"
    >
      <h1 className="type-page-title">
        {t('notFound.title')}
      </h1>
      <p className="mt-3 type-body-sm">
        {t('notFound.description')}
      </p>
      <Link
        href={routes.brands()}
        className={buttonVariants({ variant: 'primary', className: 'mt-6' })}
      >
        {t('notFound.browseAll')}
      </Link>
    </PageShell>
  )
}
