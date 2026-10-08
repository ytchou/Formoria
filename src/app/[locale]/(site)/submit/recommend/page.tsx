import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import SubmitForm from '@/components/submit/SubmitForm'
import { routes } from '@/lib/routes'

type RecommendPageProps = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ name?: string | string[] }>
}

export async function generateMetadata({
  params,
}: RecommendPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('submit.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates(routes.submit.recommend(), safeLocale)
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    alternates: { canonical, languages },
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    }),
  }
}

export default async function SubmitRecommendPage({
  params,
  searchParams,
}: RecommendPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  // `?name=` comes from the directory's no-results CTA. Capped so a pathological query
  // string can't be reflected into the form wholesale; the field's own schema still validates.
  const rawName = (await searchParams)?.name
  const initialName = typeof rawName === 'string' ? rawName.trim().slice(0, 100) : ''

  return <SubmitForm initialName={initialName} />
}
