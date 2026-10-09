import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { RootDocument } from '@/components/shared/root-document'
import { pickClientMessages } from '@/i18n/client-messages'
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
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: 'landing.metadata' }),
    getTranslations({ locale: safeLocale, namespace: 'common' }),
  ])
  const description = tCommon('metadataDescription')

  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: t('title'),
      // zh titles use the full-width bar with no spaces; en keeps ' | '.
      template: safeLocale === 'zh-TW' ? '%s｜Formoria' : '%s | Formoria',
    },
    description,
    ...buildOpenGraph({
      title: t('title'),
      description,
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
      notificationsLabel={tCommon('notifications')}
    >
      <NextIntlClientProvider locale={safeLocale} messages={pickClientMessages(messages)}>
        {children}
      </NextIntlClientProvider>
    </RootDocument>
  )
}
