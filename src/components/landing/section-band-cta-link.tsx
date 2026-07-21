'use client'

import { Link } from '@/i18n/navigation'
import { trackCtaClicked } from '@/lib/analytics'

interface SectionBandCtaLinkProps {
  href: string
  label: string
  className?: string
}

export function SectionBandCtaLink({ href, label, className }: SectionBandCtaLinkProps) {
  return (
    <Link
      href={href}
      data-ph-no-autocapture
      onClick={() => trackCtaClicked('submit_brand', 'section_band', href, '/')}
      className={className}
    >
      {label}
    </Link>
  )
}
