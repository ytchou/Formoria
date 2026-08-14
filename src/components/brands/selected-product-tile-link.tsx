'use client'

import type { ReactNode } from 'react'

import { Link } from '@/i18n/navigation'
import { trackCuratedProductClicked } from '@/lib/analytics'

type SelectedProductTileLinkProps = {
  href: string
  ariaLabel: string
  className: string
  productKey: string
  brandSlug: string
  position: number
  surface: string
  children: ReactNode
}

/** Client boundary limited to the click handler; tile content stays server-rendered. */
export function SelectedProductTileLink({
  href,
  ariaLabel,
  className,
  productKey,
  brandSlug,
  position,
  surface,
  children,
}: SelectedProductTileLinkProps) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={className}
      data-ph-no-autocapture
      onClick={() =>
        trackCuratedProductClicked(productKey, brandSlug, position, surface)
      }
    >
      {children}
    </Link>
  )
}
