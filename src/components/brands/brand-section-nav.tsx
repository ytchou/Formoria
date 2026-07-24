'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Section = {
  id: string
  label: string
}

type BrandSectionNavProps = {
  sections: Section[]
}

export function BrandSectionNav({ sections }: BrandSectionNavProps) {
  const t = useTranslations('brandDetail')
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '')
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
      element.scrollIntoView({ behavior: 'smooth' })
      setActiveId(id)
    }
  }

  if (sections.length < 2) return null

  return (
    <nav
      aria-label={t('tabNav.overview')}
      className="sticky top-16 border-y border-border bg-background"
    >
      <div className="flex items-stretch">
        <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto">
          {sections.map(({ id, label }) => {
            const isActive = activeId === id

            return (
              <a
                key={id}
                href={`#${id}`}
                onClick={(event) => handleSectionClick(event, id)}
                className={cn(
                  'flex min-h-12 shrink-0 items-center border-b-2 border-transparent px-4',
                  isActive
                    ? 'type-nav-item-active border-primary'
                    : 'type-nav-item',
                )}
              >
                {label}
              </a>
            )
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="large"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="min-h-12 shrink-0 rounded-none type-nav-item"
        >
          {t('tabNav.backToTop')}
        </Button>
      </div>
    </nav>
  )
}
