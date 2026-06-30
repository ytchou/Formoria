import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { AdminModeBar } from '@/components/admin-mode/admin-mode-bar'
import { SyncHtmlLang } from '@/components/i18n/sync-html-lang'
import { Footer } from '@/components/navigation/footer'
import { MainNav } from '@/components/navigation/main-nav'
import { routing } from '@/i18n/routing'
import { readAdminModeCookie, type AdminMode } from '@/lib/auth/admin-mode'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

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
  const [messages, tAdmin] = await Promise.all([
    getMessages(),
    getTranslations('adminMode'),
  ])
  const cookieStore = await cookies()
  const adminBarMode: AdminMode | null =
    await readAdminModeCookie(cookieStore.get('fm_mode')?.value)

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SyncHtmlLang />
      <div className="relative z-50">
        {adminBarMode ? (
          <AdminModeBar
            mode={adminBarMode}
            labels={{
              god: tAdmin('god'),
              viewer: tAdmin('viewer'),
              enter: tAdmin('enter'),
              exit: tAdmin('exit'),
              banner: tAdmin('banner'),
            }}
          />
        ) : null}
        <MainNav categories={[...PRODUCT_TYPE_CATEGORIES]} />
      </div>
      <div className="flex-1">{children}</div>
      <Footer />
    </NextIntlClientProvider>
  )
}
