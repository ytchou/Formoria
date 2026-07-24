'use client'

import { Link } from '@/i18n/navigation'
import type { Brand } from '@/lib/types'
import { BrandCard } from '@/components/brands/brand-card'
import { trackCtaClicked } from '@/lib/analytics'
import { useInView } from '@/hooks/use-in-view'

interface BrandShowcaseProps {
  brands: Brand[]
  heading: string
  subheading?: string
  linkText: string
  linkHref: string
}

export default function BrandShowcase({
  brands,
  heading,
  subheading,
  linkText,
  linkHref,
}: BrandShowcaseProps) {
  const { ref, inView } = useInView<HTMLDivElement>()

  if (brands.length === 0) return null

  return (
    <section>
      <div className="mb-6">
        <h2 className="type-section-title-large">{heading}</h2>
        {subheading && (
          <p className="mt-1 type-card-description">{subheading}</p>
        )}
      </div>
      <div
        ref={ref}
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
      >
        {brands.map((brand, index) => (
          <div
            key={brand.id}
            className={inView ? 'animate-reveal-up' : 'opacity-0'}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <BrandCard brand={brand} position={index} />
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Link
          href={linkHref}
          data-ph-no-autocapture
          onClick={() => trackCtaClicked('browse_all', 'showcase', linkHref, '/')}
          className="font-medium text-primary"
        >
          {linkText}
        </Link>
      </div>
    </section>
  )
}
