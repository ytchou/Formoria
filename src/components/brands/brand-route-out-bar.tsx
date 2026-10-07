'use client'

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { SaveBrandButton } from './save-brand-button'

interface BrandRouteOutBarProps {
  /** The hero's visit CTA. The bar shows only once it has scrolled out above. */
  ctaRef: RefObject<HTMLElement | null>
  href: string
  label: string
  brandName: string
  brandId?: string
  brandSlug: string
  onVisitClick: () => void
}

function subscribeToNothing() {
  return () => undefined
}

/**
 * Mobile sticky route out to the brand (BD-31). A 5,000px+ mobile page
 * otherwise leaves its only visit-website CTA near the top.
 *
 * Portalled to `document.body` so no transformed ancestor — the hero's
 * `animate-reveal-up` animates `translate` — can become the containing block
 * of `position: fixed`.
 */
export function BrandRouteOutBar({
  ctaRef,
  href,
  label,
  brandName,
  brandId,
  brandSlug,
  onVisitClick,
}: BrandRouteOutBarProps) {
  // Server and hydration render false; the client snapshot is true, so the
  // portal target exists before anything is rendered into it.
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  )
  const [ctaPassed, setCtaPassed] = useState(false)
  const [footerInView, setFooterInView] = useState(false)

  useEffect(() => {
    const cta = ctaRef.current
    if (!cta || typeof IntersectionObserver === 'undefined') return

    // "Passed" means out of view ABOVE the viewport. Out of view below (the
    // page has not reached it yet) never shows the bar.
    const ctaObserver = new IntersectionObserver(([entry]) => {
      if (!entry) return
      const viewportTop = entry.rootBounds?.top ?? 0
      setCtaPassed(
        !entry.isIntersecting && entry.boundingClientRect.bottom <= viewportTop,
      )
    })
    ctaObserver.observe(cta)

    // The bar would sit on top of the footer's links, so it steps aside while
    // any of the footer is on screen. The role pins the site footer, not a
    // <footer> some card or quote inside the page might render.
    const footer = document.querySelector('footer[role="contentinfo"]')
    const footerObserver = footer
      ? new IntersectionObserver(([entry]) => {
          if (entry) setFooterInView(entry.isIntersecting)
        })
      : null
    if (footer) footerObserver?.observe(footer)

    return () => {
      ctaObserver.disconnect()
      footerObserver?.disconnect()
    }
  }, [ctaRef])

  // Hidden means unmounted, not transparent: nothing in it can take focus.
  if (!isClient || !ctaPassed || footerInView) return null

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-ground pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="page-gutter flex items-center gap-3 py-2">
        <span className="type-label min-w-0 flex-1 truncate">{brandName}</span>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'primary' })}
          data-ph-no-autocapture
          onClick={onVisitClick}
        >
          <ExternalLink className="size-[15px]" />
          {label}
        </a>
        {brandId && (
          <SaveBrandButton brandId={brandId} slug={brandSlug} variant="inline" iconOnly />
        )}
      </div>
    </div>,
    document.body,
  )
}
