'use client'

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter, usePathname } from '@/i18n/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { trackCategoryFilterApplied } from '@/lib/analytics'
import { categoryLabel } from '@/lib/taxonomy/ontology'
import { buildCategoryTabTarget } from './category-tab-target'

interface NavCategoryTabsProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>
}

function NavCategoryTabsInner({ categories }: NavCategoryTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations('nav')

  const isBrandsPage = pathname === '/brands'
  const activeCategory = isBrandsPage ? (searchParams.get('category') ?? '') : ''

  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })
  const [hasIndicator, setHasIndicator] = useState(false)

  const updateIndicator = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const activeBtn = container.querySelector<HTMLElement>('[data-active="true"]')
    if (!activeBtn) {
      setHasIndicator(false)
      return
    }
    const containerRect = container.getBoundingClientRect()
    const btnRect = activeBtn.getBoundingClientRect()
    setIndicator({
      left: btnRect.left - containerRect.left + container.scrollLeft,
      width: btnRect.width,
    })
    setHasIndicator(true)
  }, [])

  useEffect(() => {
    updateIndicator()
  }, [activeCategory, updateIndicator])

  function targetFor(slug: string) {
    return buildCategoryTabTarget({
      pathname,
      searchParams: searchParams.toString(),
      slug,
      locale,
    })
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>, slug: string) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    const { routerPath } = targetFor(slug)

    if (slug) {
      trackCategoryFilterApplied(slug)
    }

    if (isBrandsPage) {
      router.replace(routerPath)
    } else {
      router.push(routerPath)
    }
  }

  return (
    <nav className="page-gutter mx-auto max-w-screen-xl overflow-x-hidden">
      <div ref={containerRef} className="relative flex min-h-12 items-center gap-1 overflow-x-auto scrollbar-none">
        <a
          href={targetFor('').href}
          data-active={isBrandsPage && !activeCategory ? 'true' : 'false'}
          aria-current={isBrandsPage && !activeCategory ? 'page' : undefined}
          data-ph-no-autocapture
          onClick={(event) => handleClick(event, '')}
          className={
            isBrandsPage && !activeCategory
              ? 'type-body-emphasis flex min-h-12 items-center whitespace-nowrap px-3 py-2'
              : 'type-card-description hover:text-foreground flex min-h-12 items-center whitespace-nowrap px-3 py-2 transition-colors'
          }
        >
          {t('allBrands')}
        </a>
        {categories.map((cat) => {
          const isActive = activeCategory === cat.slug
          const label = categoryLabel(cat, locale)
          const target = targetFor(cat.slug)
          return (
            <a
              key={cat.slug}
              href={target.href}
              data-active={isActive ? 'true' : 'false'}
              aria-current={isActive ? 'page' : undefined}
              data-ph-no-autocapture
              onClick={(event) => handleClick(event, cat.slug)}
              className={
                isActive
                  ? 'type-body-emphasis flex min-h-12 items-center whitespace-nowrap px-3 py-2'
                  : 'type-card-description hover:text-foreground flex min-h-12 items-center whitespace-nowrap px-3 py-2 transition-colors'
              }
            >
              {label}
            </a>
          )
        })}

        {hasIndicator && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-primary"
            style={{
              left: indicator.left,
              width: indicator.width,
              transition: `left var(--duration-morph) var(--ease-settle), width var(--duration-morph) var(--ease-settle)`,
            }}
          />
        )}
      </div>
    </nav>
  )
}

function NavCategoryTabsFallback() {
  return (
    <nav
      aria-hidden="true"
      className="page-gutter mx-auto max-w-screen-xl overflow-x-hidden"
    >
      <div className="min-h-12" />
    </nav>
  )
}

export function NavCategoryTabs({ categories }: NavCategoryTabsProps) {
  return (
    <Suspense fallback={<NavCategoryTabsFallback />}>
      <NavCategoryTabsInner categories={categories} />
    </Suspense>
  )
}
