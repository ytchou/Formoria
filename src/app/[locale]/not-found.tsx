import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'

export default async function NotFound() {
  const t = await getTranslations('errors')

  return (
    <main className="mx-auto flex max-w-screen-xl flex-col items-start px-6 py-24 md:px-10">
      <h1 className="type-page-title-large">
        {t('notFound.title')}
      </h1>
      <p className="mt-3 type-card-description">
        {t('notFound.description')}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/"
          className={buttonVariants({ variant: 'primary', tone: 'cta' })}
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
