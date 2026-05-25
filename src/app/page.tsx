import { Suspense } from 'react'
import type { Metadata } from 'next'
import { buildWebSiteJsonLd } from '@/lib/json-ld'
import { HeroSection } from '@/components/landing/hero-section'
import { SearchInput } from '@/components/brands/search-input'
import { ValueProps } from '@/components/landing/value-props'

export const revalidate = 3600

export const metadata: Metadata = {
  title: { absolute: 'MIT Map — 探索台灣製造品牌' },
  description:
    '探索並發現精選的台灣製造品牌。從食品到時尚，支持本土設計師和製造商。',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'MIT Map — 探索台灣製造品牌',
    description: '探索並發現精選的台灣製造品牌。從食品到時尚，支持本土設計師和製造商。',
  },
}

export default async function LandingPage() {
  const jsonLd = buildWebSiteJsonLd()

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main>
        <HeroSection />
        <section className="mx-auto max-w-screen-xl px-6 py-8 md:px-10">
          <Suspense fallback={null}>
            <SearchInput placeholder="搜尋品牌..." redirectTo="/brands" />
          </Suspense>
        </section>
        <ValueProps />
      </main>
    </>
  )
}
