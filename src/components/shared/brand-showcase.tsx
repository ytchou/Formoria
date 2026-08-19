'use client'

import { Link } from '@/i18n/navigation'
import type { PublicBrandCard } from '@/lib/brands/contracts'
import { BrandCard } from '@/components/brands/brand-card'
import { SectionHeader } from '@/components/shared/section-header'
import { trackCtaClicked } from '@/lib/analytics'
import { useInView } from '@/hooks/use-in-view'
import { Grid } from '@/components/ui/grid'

interface BrandShowcaseProps {
  brands: PublicBrandCard[]
  heading: string
  subheading?: string
  linkText: string
  linkHref: string
  /** Stable analytics surface for both the rail CTA and its brand cards. */
  ctaLocation: string
}

export default function BrandShowcase({
  brands,
  heading,
  subheading,
  linkText,
  linkHref,
  ctaLocation,
}: BrandShowcaseProps) {
  const { ref, inView } = useInView<HTMLDivElement>()

  if (brands.length === 0) return null

  return (
    <section>
      {/* The one shared header, so the directory rail is titled exactly the way the
          selection wall and the trust seam above it are. Its link slot stays
          empty: the rail's CTA is tracked, and one destination announced twice
          is a second tab stop to the same place. */}
      <SectionHeader heading={heading} note={subheading} className="mb-6" />
      <Grid ref={ref}>
        {brands.map((brand, index) => (
          <div
            key={brand.id}
            className={inView ? 'animate-reveal-up' : 'opacity-0'}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <BrandCard brand={brand} position={index} listSource={ctaLocation} />
          </div>
        ))}
      </Grid>
      <div className="mt-6">
        <Link
          href={linkHref}
          data-ph-no-autocapture
          onClick={() => trackCtaClicked('browse_all', ctaLocation, linkHref, '/')}
          className="font-medium text-accent"
        >
          {linkText}
        </Link>
      </div>
    </section>
  )
}
