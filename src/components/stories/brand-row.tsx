import type { ReactNode } from 'react'

type BrandRowProps = {
  /**
   * The row's cards, authored as plain `<BrandCard slug="…" />` shortcodes.
   *
   * Children, never a `slugs` array: MDX expression attributes (`slugs={[…]}`)
   * are silently dropped by the story pipeline (DEV-1302), so an array prop
   * would arrive `undefined` at runtime — that is exactly what broke
   * `BrandGrid`. Children pass through intact, which is also what let the
   * retired `BrandSpotlight` carry its prose. Do not add an array prop.
   */
  children?: ReactNode
}

/**
 * `<BrandRow>…</BrandRow>` inside story MDX: three brand cards for one
 * category section, in place of the retired one-brand `BrandSpotlight`.
 *
 * A layout wrapper and nothing else. It must not clone or inspect its children
 * — they are already-rendered `BrandCard` elements from the MDX map — so the
 * fixed mobile card width is applied with a child selector rather than a
 * per-child wrapper element, which keeps the DOM at one node per card.
 *
 * Mobile is the house scroller idiom (see `brands/image-carousel.tsx`): a
 * snapping horizontal overflow, no arrows, no dots, no JS, no state. At `sm`
 * and up it becomes a 3-column grid and the cards auto-size to ~229px inside
 * the 720px prose column.
 */
export function BrandRow({ children }: BrandRowProps) {
  return (
    <div
      className={[
        'scrollbar-none my-10 flex snap-x snap-mandatory gap-4 overflow-x-auto',
        // 272px on mobile leaves the next card visibly breaking the right edge
        // at 375px, which is what signals the row scrolls at all.
        '[&>*]:w-[272px] [&>*]:shrink-0 [&>*]:snap-start',
        'sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:[&>*]:w-auto',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
