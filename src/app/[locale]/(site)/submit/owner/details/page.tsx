import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import SubmissionWizard from '@/components/submit/wizard/SubmissionWizard'
import { signInHref } from '@/i18n/locale-preference'
import { buildAlternates, type Locale } from '@/lib/seo/alternates'
import { getApprovedProductTagSuggestions } from '@/lib/services/product-tag-suggestions'
import { createClient } from '@/lib/supabase/server'

type OwnerDetailsPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: OwnerDetailsPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.metadata')

  return {
    title: t('title'),
    description: t('description'),
    alternates: buildAlternates('/submit/owner/details', locale as Locale),
  }
}

export default async function SubmitOwnerDetailsPage({
  params,
}: OwnerDetailsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect(signInHref('/submit/owner/details', locale))
  }

  const [t, productTagSuggestions] = await Promise.all([
    getTranslations('submit.submissionWizard'),
    getApprovedProductTagSuggestions(),
  ])

  return (
    <div className="page-gutter mx-auto w-full max-w-6xl py-12">
      <div className="mb-8 max-w-3xl">
        <h1 className="text-balance type-page-title-large">{t('heading')}</h1>
        <p className="mt-3 type-card-description">{t('subheading')}</p>
      </div>
      <SubmissionWizard productTagSuggestions={productTagSuggestions} />
    </div>
  )
}
