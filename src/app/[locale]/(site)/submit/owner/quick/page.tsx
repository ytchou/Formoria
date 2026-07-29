import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import SubmitQuickForm from '@/components/submit/SubmitQuickForm'
import { signInHref } from '@/i18n/locale-preference'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'
import { createClient } from '@/lib/supabase/server'

type QuickOwnerPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: QuickOwnerPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.quickForm')

  return {
    title: t('heading'),
    description: t('subheading'),
    alternates: buildAlternates('/submit/owner/quick', locale as Locale),
  }
}

export default async function SubmitOwnerQuickPage({
  params,
}: QuickOwnerPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  // Gate before the auth check so signed-out visitors get a 404 rather than a
  // sign-in bounce into a route that no longer exists.
  if (!(await isOwnerFeaturesEnabled())) {
    notFound()
  }

  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect(signInHref('/submit/owner/quick', locale))
  }

  return <SubmitQuickForm />
}
