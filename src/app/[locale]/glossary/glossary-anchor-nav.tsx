'use client'

import { useEffect, useRef, useState } from 'react'

type Section = {
  id: string
  label: string
}

type GlossaryAnchorNavProps = {
  sections: Section[]
  sectionsLabel: string
}

export function GlossaryAnchorNav({ sections, sectionsLabel }: GlossaryAnchorNavProps) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '')
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const sectionEls = sections
      .map(({ id }) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)

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

    sectionEls.forEach((el) => observerRef.current!.observe(el))

    return () => observerRef.current?.disconnect()
  }, [sections])

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault()
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
      setActiveId(id)
    }
  }

  return (
    <>
      {/* Desktop: sticky left sidebar */}
      <nav
        aria-label="Glossary sections"
        className="hidden w-60 shrink-0 md:block"
      >
        <div className="sticky top-16">
          <p className="mb-3 type-eyebrow-muted">
            {sectionsLabel}
          </p>
          <ul className="space-y-1">
            {sections.map(({ id, label }) => {
              const isActive = activeId === id
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(e) => handleClick(e, id)}
                    className={[
                      'flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors',
                      isActive
                        ? 'font-semibold text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    <span
                      aria-hidden
                      className={[
                        'h-1.5 w-1.5 rounded-full transition-colors',
                        isActive ? 'bg-primary' : 'bg-transparent',
                      ].join(' ')}
                    />
                    {label}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      {/* Mobile: horizontal pill scroll bar */}
      <nav
        aria-label="Glossary sections"
        className="mb-6 md:hidden"
      >
        <div className="flex gap-2 overflow-x-auto pb-2">
          {sections.map(({ id, label }) => {
            const isActive = activeId === id
            return (
              <a
                key={id}
                href={`#${id}`}
                onClick={(e) => handleClick(e, id)}
                className={[
                  'inline-flex shrink-0 items-center rounded-full border border-border px-3 py-2 transition-colors',
                  'min-h-[44px] whitespace-nowrap',
                  isActive
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'bg-background text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </a>
            )
          })}
        </div>
      </nav>
    </>
  )
}
