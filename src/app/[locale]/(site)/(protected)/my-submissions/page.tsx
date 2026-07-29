import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'

type MySubmissionsPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: MySubmissionsPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('mySubmissions')
  return {
    title: t('metadata.title'),
    description: t('subheading'),
    alternates: buildAlternates('/my-submissions', locale as Locale),
    robots: { index: false, follow: true },
  }
}

export default async function MySubmissionsPage({ params }: MySubmissionsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  // With owner features off the dashboard 404s, so send visitors home instead.
  const destination = (await isOwnerFeaturesEnabled()) ? '/dashboard' : '/'
  redirect(localizePath(destination, locale))
}
