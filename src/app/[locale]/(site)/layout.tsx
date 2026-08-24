import type { Metadata } from 'next'
import { Footer } from '@/components/navigation/footer'
import { MainNav } from '@/components/navigation/main-nav'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { L1_CATEGORIES } from '@/lib/taxonomy/ontology'

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
      <MainNav categories={[...L1_CATEGORIES]} />
      <div id="main-content" className="flex-1">{children}</div>
      <Footer />
    </>
  )
}
