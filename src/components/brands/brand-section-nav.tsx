'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { shouldShowBrandSectionNav } from '@/lib/brands/section-nav'

type Section = {
  id: string
  label: string
}

type BrandSectionNavProps = {
  sections: Section[]
  ariaLabel?: string
  /**
   * Pin the strip under the site nav. The page passes `false` when the brand
   * has a route-out link: the mobile route-out bar is then the single sticky
   * bar, and the strip stays in flow so the chrome never stacks (BD2-10).
   */
  sticky?: boolean
}

/** Top inset of the observer's active band (clears the sticky site nav). */
const ACTIVE_BAND_TOP = 80

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function BrandSectionNav({
  sections,
  ariaLabel,
  sticky = true,
}: BrandSectionNavProps) {
  const t = useTranslations('brandDetail')
  const [activeId, setActiveId] = useState(sections.at(0)?.id ?? '')
  const [hasMoreRight, setHasMoreRight] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (sections.length < 2) return

    const sectionEls = sections
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)

    const activeMap = new Map<string, boolean>()
    const firstEl = sectionEls.at(0)

    // Above the first section (back in the hero) the first section is the
    // active one, or a stale `aria-current` survives the trip back up (R2-11).
    function resetIfAboveFirst() {
      if (firstEl && firstEl.getBoundingClientRect().top > ACTIVE_BAND_TOP) {
        setActiveId(firstEl.id)
      }
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          activeMap.set(entry.target.id, entry.isIntersecting)
        })
        const firstActive = sections.find(({ id }) => activeMap.get(id))
        if (firstActive) {
          setActiveId(firstActive.id)
          return
        }
        // Nothing in the band: between two sections keep the last one.
        resetIfAboveFirst()
      },
      { rootMargin: `-${ACTIVE_BAND_TOP}px 0px -60% 0px`, threshold: 0 },
    )

    sectionEls.forEach((element) => observerRef.current?.observe(element))

    // An instant jump to the top (Home key, iOS status-bar tap) from below the
    // last section changes no intersection, so the observer never fires (N-03).
    let frame = 0
    function onScroll() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!sections.some(({ id }) => activeMap.get(id))) resetIfAboveFirst()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scrollend', onScroll, { passive: true })

    return () => {
      observerRef.current?.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('scrollend', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [sections])

  // Right-edge fade while links remain off-screen: the cue that the strip
  // scrolls. Gone once the last link is reachable or nothing overflows.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    function measure() {
      if (!scroller) return
      const overflows = scroller.scrollWidth > scroller.clientWidth + 1
      const atEnd =
        scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1
      setHasMoreRight(overflows && !atEnd)
    }

    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    resizeObserver?.observe(scroller)

    return () => {
      scroller.removeEventListener('scroll', measure)
      resizeObserver?.disconnect()
    }
  }, [sections])

  // Keep the active link visible by scrolling the strip itself. Never
  // `link.scrollIntoView()`: with a non-sticky strip that would pull the whole
  // page back up to it.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !activeId) return
    const link = Array.from(scroller.querySelectorAll<HTMLElement>('a')).find(
      (anchor) => anchor.getAttribute('href') === `#${activeId}`,
    )
    if (!link) return

    const linkStart = link.offsetLeft
    const linkEnd = linkStart + link.offsetWidth
    const viewStart = scroller.scrollLeft
    const viewEnd = viewStart + scroller.clientWidth

    let left: number | null = null
    if (linkStart < viewStart) left = linkStart
    else if (linkEnd > viewEnd) left = linkEnd - scroller.clientWidth
    if (left === null || typeof scroller.scrollTo !== 'function') return

    scroller.scrollTo({
      left,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [activeId])

  function handleSectionClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ) {
    event.preventDefault()
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
      const focusTarget =
        element.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? element
      if (!focusTarget.hasAttribute('tabindex')) {
        focusTarget.setAttribute('tabindex', '-1')
      }
      focusTarget.focus({ preventScroll: true })
      setActiveId(id)
    }
  }

  if (!shouldShowBrandSectionNav(sections.length)) return null

  // Mobile only (BD-27): on md+ the content takes the full page measure, and
  // the old left rail there added chrome without adding orientation.
  return (
    // `border-b` only, never `border-y`: the strip sits directly under the hero,
    // and the bottom rule is what separates the strip from the content below.
    <nav
      aria-label={ariaLabel ?? t('tabNav.overview')}
      className={cn(
        'min-w-0 border-b border-rule bg-ground md:hidden',
        sticky && 'sticky top-(--nav-height) z-40',
      )}
    >
      <div
        ref={scrollerRef}
        className={cn(
          'scrollbar-none flex min-w-0 overflow-x-auto',
          hasMoreRight &&
            '[mask-image:linear-gradient(to_right,#000_85%,transparent)]',
        )}
      >
        {sections.map(({ id, label }) => {
          const isActive = activeId === id

          return (
            <a
              key={id}
              href={`#${id}`}
              aria-current={isActive ? 'location' : undefined}
              onClick={(event) => handleSectionClick(event, id)}
              className={cn(
                'flex min-h-12 shrink-0 items-center border-b-2 border-transparent px-3',
                isActive
                  ? 'type-nav font-semibold text-ink border-accent'
                  : 'type-nav hover:text-ink transition-colors',
              )}
            >
              {label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}
