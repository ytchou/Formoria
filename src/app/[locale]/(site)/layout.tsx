import type { Metadata } from 'next'
import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner'
import { Footer } from '@/components/navigation/footer'
import { MainNav } from '@/components/navigation/main-nav'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const { canonical, languages } = buildAlternates('/', safeLocale)

  return {
    alternates: {
      canonical,
      languages,
    },
  }
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ImpersonationBanner />
      <MainNav categories={[...PRODUCT_TYPE_CATEGORIES]} />
      <div id="main-content" className="flex-1">{children}</div>
      <Footer />
    </>
  )
}
