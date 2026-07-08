import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { createClient } from '@/lib/supabase/server'
import SubmitOverview from '@/components/submit/SubmitOverview'
import { getUserBrand } from '@/lib/services/brand-owners'

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
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    alternates: buildAlternates('/submit', safeLocale),
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
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
  const ownerPath = locale === 'en' ? '/en/submit/owner' : '/submit/owner'

  return (
    <SubmitOverview
      ownerPath={hasOwnedBrand ? `${ownerPath}?ownedNotice=1` : ownerPath}
      recommendPath={locale === 'en' ? '/en/submit/recommend' : '/submit/recommend'}
      isLoggedIn={isLoggedIn}
    />
  )
}
