import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

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
          className="inline-flex items-center justify-center rounded-lg bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33] transition-colors"
        >
          {t('notFound.cta')}
        </Link>
        <Link
          href="/brands"
          className="inline-flex items-center justify-center rounded-lg border border-[#E8E5E0] bg-white px-5 py-2.5 text-sm font-medium text-[#1A1918] hover:bg-[#F5F3F0] transition-colors"
        >
          {t('notFound.browseDirectory')}
        </Link>
      </div>
    </main>
  )
}
