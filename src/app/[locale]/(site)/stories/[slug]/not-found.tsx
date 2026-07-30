'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function StoryNotFound() {
  const t = useTranslations('stories')

  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24 text-center">
      <h1 className="type-page-title">{t('notFound.title')}</h1>
      <p className="mt-3 type-card-description">{t('notFound.description')}</p>
      <Link
        href="/stories"
        className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-6')}
      >
        {t('notFound.browseAll')}
      </Link>
    </main>
  )
}
