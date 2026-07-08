import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'

export default async function NotFound() {
  const t = await getTranslations('errors')

  return (
    <main className="mx-auto flex max-w-screen-xl flex-col items-start px-6 py-24 md:px-10">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[#1A1918]">
        {t('notFound.title')}
      </h1>
      <p className="mt-3 text-sm text-[#7C7570]">
        {t('notFound.description')}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/"
          className={buttonVariants({ variant: 'cta' })}
        >
          {t('notFound.cta')}
        </Link>
        <Link
          href="/brands"
          className={buttonVariants({ variant: 'outline' })}
        >
          {t('notFound.browseDirectory')}
        </Link>
      </div>
    </main>
  )
}
