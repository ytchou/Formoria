import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import SubmitForm from '@/components/submit/SubmitForm'

type RecommendPageProps = {
  params: Promise<{ locale: string }>
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

export default async function SubmitRecommendPage({ params }: RecommendPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  return <SubmitForm variant="recommend" />
}
