'use client'

import { Link, usePathname } from '@/i18n/navigation'
import { trackCtaClicked } from '@/lib/analytics'

interface SectionBandCtaLinkProps {
  href: string
  label: string
  ctaName: string
  ctaLocation?: string
  className?: string
}

export function SectionBandCtaLink({ href, label, ctaName, ctaLocation = 'section_band', className }: SectionBandCtaLinkProps) {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      data-ph-no-autocapture
      onClick={() => trackCtaClicked(ctaName, ctaLocation, href, pathname)}
      className={className}
    >
      {label}
    </Link>
  )
}
