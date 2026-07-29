import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { localizePath, signInHref } from '@/i18n/locale-preference'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'
import { createClient } from '@/lib/supabase/server'
import { getUserBrand } from '@/lib/services/brand-owners'
import OwnerForkClient from './owner-fork-client'

type OwnerPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: OwnerPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.metadata')

  return {
    title: t('title'),
    description: t('description'),
    alternates: buildAlternates('/submit/owner', locale as Locale),
  }
}

export default async function SubmitOwnerPage({ params }: OwnerPageProps) {
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
    redirect(signInHref('/submit/owner', locale))
  }

  const hasOwnedBrand = Boolean(await getUserBrand(user.id))
  if (hasOwnedBrand) {
    redirect(localizePath('/submit/recommend', locale))
  }

  return <OwnerForkClient />
}
