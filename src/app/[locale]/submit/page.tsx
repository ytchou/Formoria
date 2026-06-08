import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { createClient } from '@/lib/supabase/server'
import { getTags } from '@/lib/services/taxonomy'
import { SubmitWizard } from '@/components/submit/SubmitWizard'
import SubmitOverview from '@/components/submit/SubmitOverview'

type SubmitPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: SubmitPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.metadata')
  return {
    title: t('title'),
    description: t('description'),
    alternates: buildAlternates('/submit', locale as Locale),
  }
}

export default async function SubmitPage({ params }: SubmitPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return <SubmitOverview nextPath={locale === 'en' ? '/en/submit' : '/submit'} />
  }

  const categories = await getTags('product_type')

  return <SubmitWizard categories={categories} />
}
