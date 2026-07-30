import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import SubmitForm from '@/components/submit/SubmitForm'

type RecommendPageProps = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ name?: string | string[] }>
}

export async function generateMetadata({
  params,
}: RecommendPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.metadata')

  return {
    title: t('title'),
    description: t('description'),
    alternates: buildAlternates('/submit/recommend', locale as Locale),
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
