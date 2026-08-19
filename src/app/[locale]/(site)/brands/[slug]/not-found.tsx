'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'

export default function BrandNotFound() {
  const t = useTranslations('brandDetail')

  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24">
      <h1 className="type-page-title">
        {t('notFound.title')}
      </h1>
      <p className="mt-3 type-body-sm">
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
