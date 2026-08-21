import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { PageShell } from '@/components/ui/page-shell'
import { routes } from '@/lib/routes'

export default async function NotFound() {
  const locale = await getLocale()
  const t = await getTranslations({ locale, namespace: 'errors' })

  return (
    // `prose`, as at every error boundary: a centred message reads at the
    // reading measure, not across the full discovery width.
    <PageShell
      as="main"
      measure="prose"
      className="flex flex-col items-center justify-center py-section text-center"
    >
      <h1 className="type-page-title">
        {t('notFound.title')}
      </h1>
      <p className="mt-3 type-body-sm">
        {t('notFound.description')}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/"
          className={buttonVariants({ variant: 'primary' })}
        >
          {t('notFound.cta')}
        </Link>
        <Link
          href={routes.brands()}
          className={buttonVariants({ variant: 'secondary' })}
        >
          {t('notFound.browseDirectory')}
        </Link>
      </div>
    </PageShell>
  )
}
