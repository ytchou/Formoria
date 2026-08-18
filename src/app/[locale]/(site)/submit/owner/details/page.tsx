import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import SubmissionWizard from '@/components/submit/wizard/SubmissionWizard'
import { signInHref } from '@/i18n/locale-preference'
import { buildAlternates, type Locale } from '@/lib/seo/alternates'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'
import { getApprovedSubcategorySuggestions } from '@/lib/services/subcategory-suggestions'
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

  // Read the session first so this route stays dynamic. Gating before any
  // dynamic API makes the page statically eligible, which bakes a flag-off 404
  // into the prerender — the flag's `revalidatePaths` never busts it, so the
  // kill switch would become one-way until the next deploy.
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  // Gate before the auth redirect so signed-out visitors get a 404 rather than a
  // sign-in bounce into a route that no longer exists.
  if (!(await isOwnerFeaturesEnabled())) {
    notFound()
  }

  if (error || !user) {
    redirect(signInHref('/submit/owner/details', locale))
  }

  const [t, subcategorySuggestions] = await Promise.all([
    getTranslations('submit.submissionWizard'),
    getApprovedSubcategorySuggestions(),
  ])

  return (
    <div className="page-gutter mx-auto w-full max-w-6xl py-12">
      <div className="mb-8 max-w-3xl">
        <h1 className="text-balance type-page-title-large">{t('heading')}</h1>
        <p className="mt-3 type-card-description">{t('subheading')}</p>
      </div>
      <SubmissionWizard subcategorySuggestions={subcategorySuggestions} />
    </div>
  )
}
