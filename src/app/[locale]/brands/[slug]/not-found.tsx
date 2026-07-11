import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'

export default async function BrandNotFound() {
  const t = await getTranslations('brandDetail')

  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24">
      <h1 className="type-page-title-large">
        {t('notFound.title')}
      </h1>
      <p className="mt-3 type-card-description">
        {t('notFound.description')}
      </p>
      <Link
        href="/brands"
        className={buttonVariants({ variant: 'primary', className: 'mt-6' })}
      >
        {t('notFound.browseAll')}
      </Link>
    </main>
  )
}
