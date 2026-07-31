'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BrandCard } from '@/components/brands/brand-card'
import { MasonryGrid } from '@/components/brands/masonry-grid'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { ToggleChip } from '@/components/ui/toggle-chip'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import type { EventAreaOption, EventBrandEntry } from '@/lib/services/events'

type EventBrandGridProps = {
  /** The full lineup. Filtering happens here, never on the server. */
  entries: EventBrandEntry[]
  areaOptions: EventAreaOption[]
  eventSlug: string
  locale: string
}

/**
 * Reads `?area=` once, on mount, and hands it to the parent's state.
 *
 * Isolated into its own `Suspense`-wrapped, render-nothing child on purpose:
 * `useSearchParams` opts its entire subtree into client rendering, and Next
 * requires a boundary around it. Wrapping the grid instead would trade the
 * crawlable, statically rendered lineup for a fallback — the lineup is the
 * whole point of the page, so only the seed sits behind the boundary.
 */
function AreaParamSeed({
  areaOptions,
  onSeed,
}: {
  /**
   * Compared by identity in the effect deps, deliberately not flattened into a
   * joined string first: `areaOptions` is a prop of a server-rendered parent and
   * `onSeed` is a `useState` setter, so both are already stable. Encoding the
   * values into one delimited string only made the allowlist lossy — an area
   * containing the delimiter would split into entries that are not real areas.
   */
  areaOptions: EventAreaOption[]
  onSeed: (area: string) => void
}) {
  const searchParams = useSearchParams()
  const requested = searchParams.get('area')

  useEffect(() => {
    if (!requested) return
    // An `?area=` naming an area this event does not have is ignored rather
    // than applied: applying it would render an empty grid for a link that
    // looks legitimate.
    if (!areaOptions.some((option) => option.value === requested)) return
    onSeed(requested)
  }, [areaOptions, onSeed, requested])

  return null
}

export function EventBrandGrid({
  entries,
  areaOptions,
  eventSlug,
  locale,
}: EventBrandGridProps) {
  const t = useTranslations('events')
  const [activeArea, setActiveArea] = useState<string | null>(null)
  const isEnglish = locale === 'en'

  const applyArea = useCallback((next: string | null) => {
    setActiveArea(next)
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    if (next) url.searchParams.set('area', next)
    else url.searchParams.delete('area')

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

  const visible = useMemo(
    () =>
      activeArea === null
        ? entries
        : entries.filter((entry) => entry.area === activeArea),
    [activeArea, entries],
  )

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <AreaParamSeed areaOptions={areaOptions} onSeed={setActiveArea} />
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

        {/*
          `role="status"` (polite), never `role="alert"`: filtering must announce
          the new result count without interrupting, and focus deliberately
          stays on the chip the reader just pressed.
        */}
        <p role="status" className="type-caption">
          {t('brandCount', { count: visible.length })}
        </p>
      </div>

      <SavedBrandsProvider>
        {/*
          Counts the full lineup, not the filtered view: `view_item_list` is a
          once-per-page impression, and keying it to `visible.length` would
          re-fire it on every chip press.
        */}
        <ViewItemListTracker listName={`event:${eventSlug}`} itemCount={entries.length} />
        <MasonryGrid>
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
                // Matches `MasonryGrid`'s own four-column above-the-fold row.
                priority={index < 4}
                position={index}
              />
            )
          })}
        </MasonryGrid>
      </SavedBrandsProvider>
    </div>
  )
}
