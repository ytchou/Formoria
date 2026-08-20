import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { createClient } from '@/lib/supabase/server'
import SubmitOverview from '@/components/submit/SubmitOverview'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'
import { getUserBrand } from '@/lib/services/brand-owners'
import { routes } from '@/lib/routes'

type SubmitPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: SubmitPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('submit.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates(routes.submit.index(), safeLocale)
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

export default async function SubmitPage({ params }: SubmitPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  const isLoggedIn = !error && !!user
  const hasOwnedBrand = isLoggedIn ? Boolean(await getUserBrand(user.id)) : false
  // This page is already dynamic (it reads the session), so the flag can be
  // resolved server-side and handed to the presentational overview.
  const ownerFeaturesEnabled = await isOwnerFeaturesEnabled()

  return (
    <SubmitOverview
      recommendPath={routes.submit.recommend()}
      isLoggedIn={isLoggedIn}
      hasOwnedBrand={hasOwnedBrand}
      ownerFeaturesEnabled={ownerFeaturesEnabled}
    />
  )
}
