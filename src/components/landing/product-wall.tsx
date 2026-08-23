import { Fragment } from 'react'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from '@/components/brands/selected-product-tile'
import type { AppLocale } from '@/i18n/locale-preference'
import { SectionHeader } from '@/components/shared/section-header'
import { PageShell } from '@/components/ui/page-shell'
import type { WallSlot } from '@/lib/curated-products/home-wall'
import { cn } from '@/lib/utils'
import { WallList } from './wall-list'

/**
 * JUSTIFIED ROWS, not a masonry.
 *
 * Every tile on a line is the SAME HEIGHT and the line fills the measure, so
 * each line's bottom edge is flush and the wall as a whole is a rectangle. The
 * ratio variation is carried by WIDTH instead of height: a 4:3 tile is simply
 * wider than the 3:4 beside it.
 *
 * The mechanism is one line of flexbox arithmetic. Give every tile
 * `flex-basis` and `flex-grow` both proportional to its ratio r, and flex
 * resolves the line to `width_i = r_i * (basis unit + free space / Σr)` — that
 * is, width_i ∝ r_i EXACTLY, whether the line grows or shrinks. Height is then
 * `width_i / r_i`, the same constant for every tile on the line. Gaps do not
 * disturb it: they come out of free space before the proportional share.
 *
 * This replaced a row-span masonry (`--wall-unit`, `wallRowSpan()`), which left
 * the four columns ending up to 392px apart at the bottom of the section.
 *
 * DOM ORDER IS STILL READING ORDER. That was the reason the old layout was a
 * CSS Grid rather than `columns-*`, and it survives here: lines are formed by
 * explicit break elements in the flow, never by column-major packing.
 */

/**
 * How many tiles a phone shows before the reveal control. The one-column
 * measurement put ~30 products at roughly eighteen phone screens, which buries
 * every section under the wall. The cap is CSS-only: nothing is sliced out of
 * the markup, following `masonry-grid.tsx`'s `visibleCount`.
 */
export const WALL_MOBILE_VISIBLE_COUNT = 12

/** Hidden past the cap on phones only, and only while the wall is collapsed. */
const CAPPED_TILE_CLASS =
  'max-sm:group-data-[wall-expanded=false]/wall:hidden'

/**
 * Tiles per line: one on phones (an editorial scroll, not a wall), two from
 * `sm`, four from `lg`. Only the desktop figure is exported — the trim below
 * and the spec both read it; the tablet figure is used by the break logic in
 * this file and nowhere else.
 */
const WALL_LINE_SIZE_TABLET = 2
export const WALL_LINE_SIZE_DESKTOP = 4

/**
 * `--wall-line-h` is only a STARTING height. Flex redistributes the line to fit
 * the measure, so this sets the rough scale of a line, not its final size — the
 * useful knob is "how many tiles' worth of width", and the break elements below
 * decide the actual count.
 */
/**
 * The row gap is carried by the BREAK ELEMENTS from `sm` up, not by the list.
 *
 * A `basis-full` break occupies a flex line of its own, so with a row-gap on
 * the list every pair of tile lines was separated by TWO gaps — 32px at `lg`
 * where the design calls for 16. Setting the row gap to zero and giving the
 * break a height of exactly one gap makes the spacing single again, and puts
 * the number in one place. Phones keep the list's row gap: they render no
 * breaks (one tile per line is the basis there), so nothing else would space
 * them.
 */
const WALL_LIST_CLASS = cn(
  'flex flex-wrap gap-x-6 gap-y-6 sm:gap-x-4 sm:gap-y-0',
  'sm:[--wall-line-h:200px] lg:[--wall-line-h:260px]',
)

/** One row gap's worth of height, matching `sm:gap-x-4`. See WALL_LIST_CLASS. */
const WALL_LINE_BREAK_CLASS = 'h-0 basis-full sm:h-4'

/**
 * A zero-height full-width flex item forces the next tile onto a new line.
 *
 * This is what pins the line size to 2 and then 4 rather than letting flex pack
 * organically: an organic wrap puts a variable number of tiles per line, and a
 * final line holding one tile then stretches it to the full 1520px measure.
 *
 * `role="presentation"` matters — without it these count as list items, to
 * assistive tech and to `getAllByRole('listitem')` alike.
 */
function WallLineBreak({ className }: { className: string }) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn(WALL_LINE_BREAK_CLASS, className)}
    />
  )
}

/**
 * Trims the wall to whole lines. A lone trailing tile would otherwise stretch
 * across the entire measure under the justified-row flex rules.
 */
function trimToWholeLines(slots: WallSlot[], lineSize: number): WallSlot[] {
  if (slots.length < lineSize) return slots
  const overflow = slots.length % lineSize
  if (overflow === 0) return slots

  return slots.slice(0, slots.length - overflow)
}

export type ProductWallLabels = {
  heading: string
  note: string
  /** The phone-only reveal control, `landing.selectedProducts.showMore`. */
  showMore: string
  /** Its collapsed-state counterpart — the control is a disclosure, not a
      one-way reveal, so it stays mounted and keeps focus after activation. */
  showLess: string
  product: SelectedProductTileLabels
}

/** The homepage product wall is deliberately finite. */
export function ProductWall({
  slots,
  locale,
  labels,
}: {
  slots: WallSlot[]
  locale: AppLocale
  labels: ProductWallLabels
}) {
  // Trimmed to a whole number of desktop lines, so the LAST line is full too.
  // A multiple of four is also a multiple of the tablet line size, so one trim
  // serves both breakpoints.
  const lineSize = WALL_LINE_SIZE_DESKTOP
  const visibleSlots = trimToWholeLines(slots, lineSize)

  return (
    <section aria-labelledby="landing-selected-products" className="py-section">
      {/* Wide, but no longer edge to edge. Three measures were on the table at
          1920px: the original 72rem left 384px of margin each side (too much —
          the wall read as a narrow column), true full bleed left 40px (too
          little — the photographs ran off the page). `page-measure` is the
          middle ground, 100rem, and it is the same measure every landing
          section, the header and the footer read, so the page has ONE left
          edge. Declared in globals.css and applied through `PageShell` — never
          re-inline a cap here. */}
      <PageShell measure="page">
        {/* Spacing only. Dropping `prose-measure` from this root is
            unobservable HERE, which is weaker than inert. The note keeps a cap
            of its own — `SectionHeader` puts `prose-measure` on the `<p>`
            itself — but the `type-page-title` heading beside it loses the 48rem
            bound the root used to lend it, and its wrap width is now whatever
            the enclosing `PageShell` allows (100rem). Nothing moves at this
            call site: it passes no `linkHref`/`linkLabel` to widen the flex
            row, and `landing.selectedProducts.heading` is two words in both
            catalogues (`Formoria Selection` in en; `Formoria` plus two
            characters in zh-TW) — one short line at either bound. No Han in
            this comment on purpose: `no-hardcoded-cjk.test.ts` line-scans this
            file. A long heading, or that link pair, would make the wider bound
            visible. The two caps were 72rem and 42rem before DEV-1529. */}
        <SectionHeader
          id="landing-selected-products"
          heading={labels.heading}
          note={labels.note}
          className="mb-6"
        />

        <WallList
          ariaLabel={labels.heading}
          className={WALL_LIST_CLASS}
          showMoreLabel={labels.showMore}
          showLessLabel={labels.showLess}
          showControl={visibleSlots.length > WALL_MOBILE_VISIBLE_COUNT}
        >
          {visibleSlots.map((slot, index) => {
            const cappedClass =
              index >= WALL_MOBILE_VISIBLE_COUNT ? CAPPED_TILE_CLASS : undefined
            const position = index + 1
            // Never after the LAST tile. `visibleSlots.length` is a multiple of
            // four after the trim, so the desktop test is true for the final
            // tile too — and that break added an empty flex line plus its own
            // height below the wall.
            const isLastTile = position === visibleSlots.length
            // A break after every second tile, shown only while the line size
            // IS two; a break after every fourth, shown from `lg` where it is
            // four. Phones never break — one tile per line is the basis there.
            //
            // No `cappedClass` here: the phone cap only ever hides below `sm`,
            // where every break is already unconditionally hidden, so the class
            // was inert and implied a per-breakpoint reveal that cannot happen.
            const lineBreakClass =
              position % WALL_LINE_SIZE_DESKTOP === 0
                ? 'hidden sm:block'
                : position % WALL_LINE_SIZE_TABLET === 0
                  ? 'hidden sm:block lg:hidden'
                  : null
            const lineBreak =
              lineBreakClass && !isLastTile ? (
                <WallLineBreak key={`break-${index}`} className={lineBreakClass} />
              ) : null

            const tile = (
              <SelectedProductTile
                key={`${slot.product.brandSlug}-${slot.product.key}`}
                locale={locale}
                product={slot.product}
                labels={labels.product}
                mode="wall"
                ratio={slot.ratio}
                className={cappedClass}
                brand={slot.product.brand}
                brandSlug={slot.product.brandSlug}
                brandName={slot.product.brandName}
                tracking={{
                  brandSlug: slot.product.brandSlug,
                  position: index,
                  surface: 'homepage_wall',
                }}
              />
            )

            // Fragment rather than an array so the break stays adjacent to the
            // tile it follows and React keeps both keyed.
            return lineBreak ? (
              <Fragment key={`slot-${index}`}>
                {tile}
                {lineBreak}
              </Fragment>
            ) : (
              tile
            )
          })}
        </WallList>

        <ViewItemListTracker listName="home_wall" itemCount={visibleSlots.length} />

        {/* The continuation strip is GONE (2026-08-17). Its trail links now
            render as their own zone below, with the same StoryRow design the
            topics zone uses — a bare list of underlined links at the foot of a
            photographic wall was the weakest possible presentation for the
            editorial content it pointed at. The category nav and the brands
            button that also lived here were removed earlier; both destinations
            are still linked from the hero. */}
      </PageShell>
    </section>
  )
}
