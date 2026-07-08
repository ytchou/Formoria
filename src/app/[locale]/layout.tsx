import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner'
import { SyncHtmlLang } from '@/components/i18n/sync-html-lang'
import { Footer } from '@/components/navigation/footer'
import { MainNav } from '@/components/navigation/main-nav'
import { routing } from '@/i18n/routing'
import {
  getImpersonatedBrandSlug,
  getImpersonationExpiresAt,
} from '@/lib/auth/impersonation'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { getBrandBySlugForAdmin } from '@/lib/services/brand-owners'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { createClient } from '@/lib/supabase/server'
import { getUserBrand } from '@/lib/services/brand-owners'

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const { canonical, languages } = buildAlternates('/', safeLocale)

  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
  }
}

export default async function LocaleLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound()
  }

  setRequestLocale(locale)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const [messages, impersonatedBrandSlug, impersonationExpiresAt, ownedBrand] = await Promise.all([
    getMessages(),
    getImpersonatedBrandSlug(),
    getImpersonationExpiresAt(),
    user ? getUserBrand(user.id) : Promise.resolve(null),
  ])
  const impersonatedBrand = impersonatedBrandSlug
    ? await getBrandBySlugForAdmin(impersonatedBrandSlug)
    : null
  const tImpersonate = impersonatedBrand
    ? await getTranslations('impersonation')
    : null
  const initialImpersonationMinutesLeft = impersonationExpiresAt
    ? Math.max(0, Math.ceil((impersonationExpiresAt - Date.now() / 1000) / 60))
    : 0

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SyncHtmlLang />
      {impersonatedBrand && impersonationExpiresAt && tImpersonate ? (
        <ImpersonationBanner
          brandName={impersonatedBrand.brandName}
          expiresAt={impersonationExpiresAt}
          initialMinutesLeft={initialImpersonationMinutesLeft}
          labels={{
            banner: tImpersonate('banner', {
              brandName: impersonatedBrand.brandName,
            }),
            exit: tImpersonate('exit'),
            timeRemaining: tImpersonate.raw('timeRemaining'),
          }}
        />
      ) : null}
      <div className="relative z-50">
        <MainNav
          categories={[...PRODUCT_TYPE_CATEGORIES]}
          hasOwnedBrand={Boolean(ownedBrand)}
          isAuthenticated={Boolean(user)}
        />
      </div>
      <div className="flex-1">{children}</div>
      <Footer />
    </NextIntlClientProvider>
  )
}
