import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import SubmitQuickForm from '@/components/submit/SubmitQuickForm'
import { signInHref } from '@/i18n/locale-preference'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
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
