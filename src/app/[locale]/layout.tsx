import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner'
import { Footer } from '@/components/navigation/footer'
import { MainNav } from '@/components/navigation/main-nav'
import { RootDocument } from '@/components/shared/root-document'
import { routing } from '@/i18n/routing'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { getSiteUrl } from '@/lib/seo/site-url'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import '../globals.css'

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
  const t = await getTranslations({ locale: safeLocale, namespace: 'landing.metadata' })
  const { canonical, languages } = buildAlternates('/', safeLocale)

  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: t('title'),
      template: '%s | Formoria',
    },
    description: t('description'),
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      siteName: 'Formoria',
      type: 'website',
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
    twitter: {
      card: 'summary_large_image',
    },
  }
}

export default async function LocaleLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound()
  }

  setRequestLocale(locale)
  const safeLocale = locale as Locale
  const [messages, tCommon] = await Promise.all([
    getMessages({ locale: safeLocale }),
    getTranslations({ locale: safeLocale, namespace: 'common' }),
  ])
  return (
    <RootDocument
      locale={safeLocale}
      skipToContentLabel={tCommon('skipToContent')}
      feedbackCopy={messages.feedbackWidget as Record<string, string>}
    >
      <NextIntlClientProvider locale={safeLocale} messages={messages}>
        <ImpersonationBanner />
        <MainNav categories={[...PRODUCT_TYPE_CATEGORIES]} />
        <div id="main-content" className="flex-1">{children}</div>
        <Footer />
      </NextIntlClientProvider>
    </RootDocument>
  )
}
