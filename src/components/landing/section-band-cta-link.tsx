'use client'

import { Link } from '@/i18n/navigation'
import { trackCtaClicked } from '@/lib/analytics'

interface SectionBandCtaLinkProps {
  href: string
  label: string
  ctaName: string
  ctaLocation?: string
  className?: string
}

export function SectionBandCtaLink({ href, label, ctaName, ctaLocation = 'section_band', className }: SectionBandCtaLinkProps) {
  return (
    <Link
      href={href}
      data-ph-no-autocapture
      onClick={() => trackCtaClicked(ctaName, ctaLocation, href, '/')}
      className={className}
    >
      {label}
    </Link>
  )
}
