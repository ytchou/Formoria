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
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

/**
 * One tab's classes. These are raw anchors rather than `Button` links because
 * they must work with JS off and carry `aria-current`, so the focus ring the
 * primitives provide is restated here — the base layer sets an outline COLOUR
 * and no visible replacement of its own.
 *
 * The tap target reads `--nav-row-categories`, the same token as the row that
 * holds it. A literal here would win over a smaller row token and grow the
 * header without growing `--nav-height`, which is the drift this row already
 * caused once. See `nav-height.test.ts`.
 */
function tabClasses(active: boolean): string {
  return cn(
    'type-nav flex min-h-(--nav-row-categories) items-center whitespace-nowrap rounded-[4px] px-3 py-2 transition-colors',
    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground',
    active ? 'text-ink' : 'text-ink-muted hover:text-ink',
  )
}

interface NavCategoryTabsProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>
}

function NavCategoryTabsInner({ categories }: NavCategoryTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations('nav')

  const isBrandsPage = pathname === routes.brands()
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
    const target = targetFor(slug)
    const { routerPath } = target

    if (slug) {
      trackCategoryFilterApplied(slug)
    }

    if (target.routerPath.split('?')[0] === pathname) {
      router.replace(routerPath)
    } else {
      router.push(routerPath)
    }
  }

  return (
    // `page-measure`: this row is part of the sticky header, which no longer
    // carries a measure of its own — header and content share one, so they
    // share a left edge. See the comment beside `--page-measure` in globals.css.
    // NAMED, because it is no longer the header's only navigation landmark and
    // is no longer suppressed on `/` — three unnamed `nav` elements in one
    // banner are three identical entries in a landmark list.
    <nav
      aria-label={t('categories')}
      className="page-gutter mx-auto page-measure overflow-x-hidden"
    >
      {/* One row that scrolls horizontally on a phone rather than wrapping:
          thirteen zh-TW labels wrap to three lines at 375px and push the page
          down by 96px before any content. */}
      <div ref={containerRef} className="relative flex min-h-(--nav-row-categories) items-center gap-1 overflow-x-auto scrollbar-none">
        <a
          href={targetFor('').href}
          data-active={isBrandsPage && !activeCategory ? 'true' : 'false'}
          aria-current={isBrandsPage && !activeCategory ? 'page' : undefined}
          data-ph-no-autocapture
          onClick={(event) => handleClick(event, '')}
          className={tabClasses(isBrandsPage && !activeCategory)}
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
              className={tabClasses(isActive)}
            >
              {label}
            </a>
          )
        })}

        {hasIndicator && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-accent"
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
      className="page-gutter mx-auto page-measure overflow-x-hidden"
    >
      <div className="min-h-(--nav-row-categories)" />
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
