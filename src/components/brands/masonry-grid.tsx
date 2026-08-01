'use client'

import { Children, type ReactNode } from 'react'
import { useInView } from '@/hooks/use-in-view'
import { cn } from '@/lib/utils'

/**
 * `dense` packs more, smaller cards per row for long single-page lineups (the
 * event page's 38 cards). `/brands` stays on `default`.
 */
export type MasonryDensity = 'default' | 'dense'

interface MasonryGridProps {
  children: ReactNode
  density?: MasonryDensity
}

const DENSITY_COLUMNS: Record<MasonryDensity, string> = {
  default: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  dense: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
}

/**
 * The widest column count of each density, which is exactly the number of cards
 * in the above-the-fold row. Those cards render visible on the server: gating
 * them behind the IntersectionObserver would keep the LCP candidate at opacity 0
 * until client JS hydrates and the observer resolves.
 *
 * Exported because callers must decide which cards to `preload` using the same
 * number — a second copy of the literal drifts the moment a density changes.
 */
export const MASONRY_ABOVE_FOLD: Record<MasonryDensity, number> = {
  default: 4,
  dense: 5,
}

export function MasonryGrid({ children, density = 'default' }: MasonryGridProps) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const aboveFoldCount = MASONRY_ABOVE_FOLD[density]

  return (
    <div
      ref={ref}
      className={cn('grid gap-5', DENSITY_COLUMNS[density])}
      role="list"
    >
      {Children.map(children, (child, i) => {
        const aboveFold = i < aboveFoldCount
        return (
          <div
            role="listitem"
            className={aboveFold ? undefined : inView ? 'animate-reveal-up' : 'opacity-0'}
            style={aboveFold ? undefined : { animationDelay: `${i * 60}ms` }}
          >
            {child}
          </div>
        )
      })}
    </div>
  )
}
