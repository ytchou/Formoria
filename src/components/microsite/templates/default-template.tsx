import type { CSSProperties } from 'react'
import type { PublicMicrositeBrand } from '@/lib/brands/contracts'
import { ContactCta } from '../contact-cta'
import { Hero } from '../hero'
import { MicrositeFooter } from '../microsite-footer'
import { ProductGrid } from '../product-grid'
import { Story } from '../story'
import { siteTokensToCssVars } from '../tokens'

type DefaultTemplateProps = {
  brand: PublicMicrositeBrand
  siteContent: PublicMicrositeBrand['siteContent']
}

/**
 * v2's ground and ink carry the page; the brand's own accent is injected as
 * two CSS custom properties on this element and used by nothing else. That
 * split is the point — the chrome is Formoria's, the accent is the brand's.
 */
export function DefaultTemplate({ brand, siteContent }: DefaultTemplateProps) {
  return (
    <div
      style={siteTokensToCssVars(siteContent.tokens) as CSSProperties}
      className="min-h-screen bg-ground text-ink"
    >
      <Hero brand={brand} siteContent={siteContent} />
      <Story brand={brand} story={siteContent.story} />
      <ProductGrid brand={brand} products={siteContent.products} />
      <ContactCta siteContent={siteContent} />
      <MicrositeFooter brand={brand} />
    </div>
  )
}
