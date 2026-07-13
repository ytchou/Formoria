import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'

type PreviewBannerProps = {
  slug: string
}

export async function PreviewBanner({ slug }: PreviewBannerProps) {
  const t = await getTranslations('brandDetail')

  return (
    <>
      <div className="fixed top-0 inset-x-0 z-50 border-b border-border bg-accent text-accent-foreground">
        <div className="page-gutter mx-auto flex min-h-12 max-w-screen-xl items-center justify-between gap-4 py-2 type-body-emphasis">
          <span>{t('previewBanner')}</span>
          <Link
            href={`/dashboard/brands/${slug}/edit`}
            className="inline-flex min-h-12 items-center justify-center rounded-md px-3 font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-accent"
          >
            {t('previewBackToEdit')}
          </Link>
        </div>
      </div>
      <div aria-hidden="true" className="h-12" />
    </>
  )
}
