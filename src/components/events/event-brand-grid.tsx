'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SearchX } from 'lucide-react'
import { BrandCard } from '@/components/brands/brand-card'
import { MASONRY_ABOVE_FOLD, MasonryGrid } from '@/components/brands/masonry-grid'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ToggleChip } from '@/components/ui/toggle-chip'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import type {
  EventAreaOption,
  EventBrandEntry,
  EventCategoryOption,
} from '@/lib/services/events'

// Four rows of the grid's widest column count — derived, not written as `16`,
// so it follows the grid if its columns ever change.
const LINEUP_VISIBLE_CAP = 4 * MASONRY_ABOVE_FOLD

type EventBrandGridProps = {
  /** The full lineup. Filtering happens here, never on the server. */
  entries: EventBrandEntry[]
  areaOptions: EventAreaOption[]
  categoryOptions: EventCategoryOption[]
  eventSlug: string
  locale: string
}

/**
 * Reads `?area=` and `?category=` once, on mount, and hands them to the
 * parent's state.
 *
 * Isolated into its own `Suspense`-wrapped, render-nothing child on purpose:
 * `useSearchParams` opts its entire subtree into client rendering, and Next
 * requires a boundary around it. Wrapping the grid instead would trade the
 * crawlable, statically rendered lineup for a fallback — the lineup is the
 * whole point of the page, so only the seed sits behind the boundary.
 */
function FilterParamSeed({
  areaOptions,
  categoryOptions,
  onSeedArea,
  onSeedCategory,
}: {
  /**
   * Compared by identity in the effect deps, deliberately not flattened into a
   * joined string first: both option lists are props of a server-rendered
   * parent and the `onSeed*` callbacks are `useState` setters, so all four are
   * already stable. Encoding the values into one delimited string only made the
   * allowlist lossy — a value containing the delimiter would split into entries
   * that are not real options.
   */
  areaOptions: EventAreaOption[]
  categoryOptions: EventCategoryOption[]
  onSeedArea: (area: string) => void
  onSeedCategory: (category: string) => void
}) {
  const searchParams = useSearchParams()
  const requestedArea = searchParams.get('area')
  const requestedCategory = searchParams.get('category')

  useEffect(() => {
    if (!requestedArea) return
    // An `?area=` naming an area this event does not have is ignored rather
    // than applied: applying it would render an empty grid for a link that
    // looks legitimate.
    if (!areaOptions.some((option) => option.value === requestedArea)) return
    onSeedArea(requestedArea)
  }, [areaOptions, onSeedArea, requestedArea])

  useEffect(() => {
    if (!requestedCategory) return
    // Same allowlist rule as the area param above.
    if (!categoryOptions.some((option) => option.value === requestedCategory))
      return
    onSeedCategory(requestedCategory)
  }, [categoryOptions, onSeedCategory, requestedCategory])

  return null
}

export function EventBrandGrid({
  entries,
  areaOptions,
  categoryOptions,
  eventSlug,
  locale,
}: EventBrandGridProps) {
  const t = useTranslations('events')
  const [activeArea, setActiveArea] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  // Deliberately NOT reset when a chip changes: a reader who asked to see the
  // whole lineup should not have to ask again after every filter press.
  const [expanded, setExpanded] = useState(false)
  const isEnglish = locale === 'en'

  // Takes the whole next pair rather than reading state, because the state
  // setters are async: writing the URL from `activeArea`/`activeCategory` here
  // would mirror the previous selection, one press behind.
  const syncUrl = useCallback((area: string | null, category: string | null) => {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    if (area) url.searchParams.set('area', area)
    else url.searchParams.delete('area')
    if (category) url.searchParams.set('category', category)
    else url.searchParams.delete('category')

    // `history.replaceState`, deliberately NOT `router.replace`: a router
    // navigation re-invokes the server component and knocks this route off its
    // static/ISR path onto a dynamic render for a filter that is entirely
    // client-side. This keeps the URL shareable without touching the server.
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    )
  }, [])

  const applyArea = useCallback(
    (next: string | null) => {
      setActiveArea(next)
      syncUrl(next, activeCategory)
    },
    [activeCategory, syncUrl],
  )

  const applyCategory = useCallback(
    (next: string | null) => {
      setActiveCategory(next)
      syncUrl(activeArea, next)
    },
    [activeArea, syncUrl],
  )

  const clearFilters = useCallback(() => {
    setActiveArea(null)
    setActiveCategory(null)
    syncUrl(null, null)
  }, [syncUrl])

  // Both axes narrow together (AND): a zone chip plus a category chip means
  // "this category, in this zone", not the union of the two.
  const visible = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (activeArea === null || entry.area === activeArea) &&
          (activeCategory === null || entry.brand.category === activeCategory),
      ),
    [activeArea, activeCategory, entries],
  )

  const isFiltered = activeArea !== null || activeCategory !== null

  // Filtered-to-zero is its own state, not a variant of "no lineup": the chips
  // and the count line stay, only the grid is replaced.
  const isFilteredEmpty = visible.length === 0 && isFiltered

  // Measured against the FILTERED list, so narrowing to a zone with 12 brands
  // shows all 12 with no button rather than an unexplained cap.
  const hiddenCount = expanded ? 0 : Math.max(visible.length - LINEUP_VISIBLE_CAP, 0)

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <FilterParamSeed
          areaOptions={areaOptions}
          categoryOptions={categoryOptions}
          onSeedArea={setActiveArea}
          onSeedCategory={setActiveCategory}
        />
      </Suspense>

      <div className="space-y-3">
        {areaOptions.length > 0 ? (
          // `gap-2` (8px) rather than the tighter default: chips render at 32px
          // tall, below the 44px touch target, so the clear space between them
          // is what keeps neighbouring chips from stealing each other's taps.
          <div
            role="group"
            aria-label={t('areaFilterAria')}
            className="flex flex-wrap gap-2"
          >
            {/*
              `ToggleChip` renders a native `<button>` carrying `aria-pressed`,
              so the selected state is announced rather than signalled by fill
              colour alone.
            */}
            <ToggleChip
              size="chip"
              pressed={activeArea === null}
              onPressedChange={() => applyArea(null)}
            >
              {t('allAreas')}
            </ToggleChip>
            {areaOptions.map((option) => (
              <ToggleChip
                key={option.value}
                size="chip"
                pressed={activeArea === option.value}
                onPressedChange={(pressed) =>
                  applyArea(pressed ? option.value : null)
                }
              >
                {option.label}
              </ToggleChip>
            ))}
          </div>
        ) : null}

        {categoryOptions.length > 0 ? (
          // Same `gap-2` (8px) as the area row above, for the same reason:
          // chips render at 32px tall, below the 44px touch target, so the
          // clear space between them is what keeps neighbouring chips from
          // stealing each other's taps.
          <div
            role="group"
            aria-label={t('categoryFilterAria')}
            className="flex flex-wrap gap-2"
          >
            <ToggleChip
              size="chip"
              pressed={activeCategory === null}
              onPressedChange={() => applyCategory(null)}
            >
              {t('allCategories')}
            </ToggleChip>
            {categoryOptions.map((option) => (
              <ToggleChip
                key={option.value}
                size="chip"
                pressed={activeCategory === option.value}
                onPressedChange={(pressed) =>
                  applyCategory(pressed ? option.value : null)
                }
              >
                {option.label}
              </ToggleChip>
            ))}
          </div>
        ) : null}

        {/*
          `role="status"` (polite), never `role="alert"`: filtering must announce
          the new result count without interrupting, and focus deliberately
          stays on the chip the reader just pressed.
        */}
        <p role="status" className="type-caption">
          {/*
            A filtered view states what it was filtered from: "0 brands" alone
            reads as "this event has no lineup", which is a different and much
            worse fact than "this one zone has none".
          */}
          {isFiltered
            ? t('brandCountFiltered', {
                count: visible.length,
                total: entries.length,
              })
            : t('brandCount', { count: visible.length })}
        </p>
      </div>

      <SavedBrandsProvider>
        {/*
          Counts the full lineup, not the filtered view: `view_item_list` is a
          once-per-page impression, and keying it to `visible.length` would
          re-fire it on every chip press.
        */}
        <ViewItemListTracker listName={`event:${eventSlug}`} itemCount={entries.length} />
        {isFilteredEmpty ? (
          // A chip combination that matches nothing used to render an empty
          // grid under "0 brands", which looks like a broken page rather than a
          // filter result. The action is the way back — the chips are above the
          // fold here, but not once the lineup is long. It clears BOTH axes:
          // with two filters live, resetting only one can still leave zero.
          <EmptyState
            icon={<SearchX />}
            title={t('filteredEmptyTitle')}
            body={t('filteredEmptyBody')}
            action={
              <Button type="button" variant="secondary" onClick={clearFilters}>
                {t('clearFilters')}
              </Button>
            }
          />
        ) : (
          <>
            {/*
              `visibleCount`, never a `.slice()`: an event lineup is dozens of
              cards and only the first four rows should occupy the fold, but
              every brand link stays in the server HTML because the lineup is
              the crawlable substance of this page.
            */}
            <MasonryGrid visibleCount={expanded ? undefined : LINEUP_VISIBLE_CAP}>
              {visible.map((entry, index) => {
                const area = isEnglish ? (entry.areaEn ?? entry.area) : entry.area

                return (
                  <BrandCard
                    key={entry.brand.id}
                    brand={entry.brand}
                    variant="editorial"
                    // Booth number wins over area: it is the more specific
                    // wayfinding fact, and the area is already on a chip above.
                    // Rendered by `BrandCard` as a `<Badge variant="secondary">`.
                    eyebrow={entry.booth ?? area ?? undefined}
                    note={
                      (isEnglish ? (entry.noteEn ?? entry.note) : entry.note) ?? undefined
                    }
                    // Read from `MasonryGrid` rather than restated, so the
                    // preloaded cards stay exactly the ones it renders visible on
                    // the server.
                    preload={index < MASONRY_ABOVE_FOLD}
                    position={index}
                  />
                )
              })}
            </MasonryGrid>

            {hiddenCount > 0 ? (
              // The count is the number still hidden, not the total: a button
              // that names what pressing it reveals is the only way the cap is
              // legible at all — the hidden cards leave no gap behind them.
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setExpanded(true)}
                >
                  {t('showAllBrands', { count: hiddenCount })}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </SavedBrandsProvider>
    </div>
  )
}
