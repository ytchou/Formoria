'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { PageShell } from '@/components/ui/page-shell'
import { Grid } from '@/components/ui/grid'
import { SurfaceImage } from '@/components/ui/image'
import { routes } from '@/lib/routes'
import {
  VISIBLE_L1_CATEGORIES,
  categoryLabel,
} from '@/lib/taxonomy/ontology'
import { trackNotFoundCategoryClicked } from '@/lib/analytics'

export function NotFoundPage() {
  const t = useTranslations('errors')
  const locale = useLocale()

  return (
    <PageShell
      as="main"
      measure="form"
      className="flex flex-col items-center py-section"
    >
      <div className="text-center">
        <h1 className="type-page-title">{t('notFound.title')}</h1>
        <p className="mt-3 type-body-sm">{t('notFound.description')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
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
      </div>

      <p className="mt-section type-body-sm text-ink-muted">
        {t('notFound.categoriesHeading')}
      </p>
      <Grid cols="thirds" className="mt-stack w-full">
        {VISIBLE_L1_CATEGORIES.map((cat, index) => (
          <Link
            key={cat.slug}
            href={routes.category(cat.slug)}
            onClick={() => trackNotFoundCategoryClicked(cat.slug, index)}
            className="group"
          >
            <div className="relative aspect-[3/2] overflow-hidden rounded-surface">
              <SurfaceImage
                src={`/images/categories/${cat.slug}.webp`}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover"
              />
            </div>
            <p className="mt-2 type-card-title">
              {categoryLabel(cat, locale)}
            </p>
          </Link>
        ))}
      </Grid>
    </PageShell>
  )
}
