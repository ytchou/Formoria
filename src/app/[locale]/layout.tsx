import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { RootDocument } from '@/components/shared/root-document'
import { routing } from '@/i18n/routing'
import type { Locale } from '@/lib/seo/alternates'
import { getSiteUrl } from '@/lib/seo/site-url'
import { buildOpenGraph } from '@/lib/seo/open-graph'
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

  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: t('title'),
      template: '%s | Formoria',
    },
    description: t('description'),
    ...buildOpenGraph({
      title: t('title'),
      description: t('description'),
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    }),
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
    >
      <NextIntlClientProvider locale={safeLocale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </RootDocument>
  )
}
