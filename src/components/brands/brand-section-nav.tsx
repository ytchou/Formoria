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
}

export function BrandSectionNav({ sections, ariaLabel }: BrandSectionNavProps) {
  const t = useTranslations('brandDetail')
  const [activeId, setActiveId] = useState(sections.at(0)?.id ?? '')
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    if (sections.length < 2) return

    const sectionEls = sections
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)

    const activeMap = new Map<string, boolean>()

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          activeMap.set(entry.target.id, entry.isIntersecting)
        })
        const firstActive = sections.find(({ id }) => activeMap.get(id))
        if (firstActive) {
          setActiveId(firstActive.id)
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )

    sectionEls.forEach((element) => observerRef.current?.observe(element))

    return () => observerRef.current?.disconnect()
  }, [sections])

  function handleSectionClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ) {
    event.preventDefault()
    const element = document.getElementById(id)
    if (element) {
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' })
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
    // and the bottom rule is what separates the sticky strip from the content
    // sliding under it.
    <nav
      aria-label={ariaLabel ?? t('tabNav.overview')}
      className="sticky top-(--nav-height) z-40 min-w-0 border-b border-rule bg-ground md:hidden"
    >
      <div className="scrollbar-none flex min-w-0 overflow-x-auto">
        {sections.map(({ id, label }) => {
          const isActive = activeId === id

          return (
            <a
              key={id}
              href={`#${id}`}
              aria-current={isActive ? 'location' : undefined}
              onClick={(event) => handleSectionClick(event, id)}
              className={cn(
                'flex min-h-12 shrink-0 items-center border-b-2 border-transparent px-4',
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
