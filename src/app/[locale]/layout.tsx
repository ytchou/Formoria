import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { AdminModeBar } from '@/components/admin-mode/admin-mode-bar'
import { SyncHtmlLang } from '@/components/i18n/sync-html-lang'
import { Footer } from '@/components/navigation/footer'
import { MainNav } from '@/components/navigation/main-nav'
import { routing } from '@/i18n/routing'
import { getActiveCategories } from '@/lib/services/taxonomy'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

const getCachedCategories = unstable_cache(
  () => getActiveCategories(),
  ['active-categories'],
  { revalidate: 3600 }
)

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
  const [messages, categories, tAdmin] = await Promise.all([
    getMessages(),
    getCachedCategories(),
    getTranslations('adminMode'),
  ])

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SyncHtmlLang />
      <AdminModeBar
        labels={{
          god: tAdmin('god'),
          viewer: tAdmin('viewer'),
          enter: tAdmin('enter'),
          exit: tAdmin('exit'),
          banner: tAdmin('banner'),
        }}
      />
      <MainNav categories={categories} />
      <div className="flex-1">{children}</div>
      <Footer />
    </NextIntlClientProvider>
  )
}
