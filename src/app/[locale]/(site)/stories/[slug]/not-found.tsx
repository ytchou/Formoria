'use client'

import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

export default function StoryNotFound() {
  const t = useTranslations('stories')

  return (
    <main className="page-gutter mx-auto flex page-measure flex-col items-center justify-center py-24 text-center">
      <h1 className="type-section">{t('notFound.title')}</h1>
      <p className="mt-3 type-body-sm">{t('notFound.description')}</p>
      {/* A raw `<a>`, not next/link. DEV-1280: full-document navigation avoids a
        stalled RSC request across the locale proxy rewrite. The
        `no-html-link-for-pages` suppression that used to sit here is gone with
        the literal href — the rule only inspects string literals, so routing
        this through `@/lib/routes` left the directive unused, which
        `reportUnusedDisableDirectives: "error"` fails on. */}
      <a
        href={routes.stories()}
        className={cn(buttonVariants({ variant: 'primary' }), 'mt-6')}
      >
        {t('notFound.browseAll')}
      </a>
    </main>
  )
}
