'use client'

import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function StoryNotFound() {
  const t = useTranslations('stories')

  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24 text-center">
      <h1 className="type-section">{t('notFound.title')}</h1>
      <p className="mt-3 type-body-sm">{t('notFound.description')}</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- DEV-1280: full-document navigation avoids a stalled RSC request across the locale proxy rewrite. */}
      <a
        href="/stories"
        className={cn(buttonVariants({ variant: 'primary' }), 'mt-6')}
      >
        {t('notFound.browseAll')}
      </a>
    </main>
  )
}
