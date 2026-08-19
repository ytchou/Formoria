import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'

export default async function NotFound() {
  const locale = await getLocale()
  const t = await getTranslations({ locale, namespace: 'errors' })

  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24 text-center">
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
          href="/brands"
          className={buttonVariants({ variant: 'secondary' })}
        >
          {t('notFound.browseDirectory')}
        </Link>
      </div>
    </main>
  )
}
