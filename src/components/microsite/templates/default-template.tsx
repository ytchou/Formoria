import type { CSSProperties } from 'react'
import type { Brand, SiteContent } from '@/lib/types/brand'
import { ContactCta } from '../contact-cta'
import { Hero } from '../hero'
import { MicrositeFooter } from '../microsite-footer'
import { ProductGrid } from '../product-grid'
import { Story } from '../story'
import { siteTokensToCssVars } from '../tokens'

type DefaultTemplateProps = {
  brand: Brand
  siteContent: SiteContent
}

export function DefaultTemplate({ brand, siteContent }: DefaultTemplateProps) {
  return (
    <div
      style={siteTokensToCssVars(siteContent.tokens) as CSSProperties}
      className="min-h-screen bg-background text-foreground"
    >
      <Hero brand={brand} siteContent={siteContent} />
      <Story brand={brand} story={siteContent.story} />
      <ProductGrid brand={brand} products={siteContent.products} />
      <ContactCta brand={brand} siteContent={siteContent} />
      <MicrositeFooter brand={brand} />
    </div>
  )
}
