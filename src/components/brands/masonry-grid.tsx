'use client'

import { Children, type ReactNode } from 'react'
import { useInView } from '@/hooks/use-in-view'

interface MasonryGridProps {
  children: ReactNode
  /**
   * Caps how many cards are VISIBLE, never how many are rendered: everything
   * past the cap keeps its markup and is hidden with CSS. Slicing the list
   * instead would drop those cards out of the server HTML, and on the event
   * lineup that HTML is the crawlable substance of the page. Unset means every
   * card shows, which is what `/brands` wants.
   */
  visibleCount?: number
}

/**
 * The widest column count, which is exactly the number of cards in the
 * above-the-fold row. Those cards render visible on the server: gating them
 * behind the IntersectionObserver would keep the LCP candidate at opacity 0
 * until client JS hydrates and the observer resolves.
 *
 * Exported because callers must decide which cards to `preload` using the same
 * number — a second copy of the literal drifts the moment the columns change.
 */
export const MASONRY_ABOVE_FOLD = 4

export function MasonryGrid({ children, visibleCount }: MasonryGridProps) {
  const { ref, inView } = useInView<HTMLDivElement>()

  return (
    <div
      ref={ref}
      className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      role="list"
    >
      {Children.map(children, (child, i) => {
        const aboveFold = i < MASONRY_ABOVE_FOLD
        const hidden = visibleCount !== undefined && i >= visibleCount
        // A hidden card is skipped by the reveal entirely — animating it would
        // burn its one-shot entrance while it is invisible, so it would appear
        // with no transition the moment the cap lifts.
        const revealClass = hidden
          ? 'hidden'
          : aboveFold
            ? undefined
            : inView
              ? 'animate-reveal-up'
              : 'opacity-0'
        return (
          <div
            role="listitem"
            className={revealClass}
            style={aboveFold || hidden ? undefined : { animationDelay: `${i * 60}ms` }}
          >
            {child}
          </div>
        )
      })}
    </div>
  )
}
