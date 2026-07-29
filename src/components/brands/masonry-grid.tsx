'use client'

import { Children, type ReactNode } from 'react'
import { useInView } from '@/hooks/use-in-view'

interface MasonryGridProps { children: ReactNode }

// Widest grid variant is `lg:grid-cols-4`, so the first four cards are the
// above-the-fold row. They render visible on the server: gating them behind the
// IntersectionObserver would keep the LCP candidate at opacity 0 until client JS
// hydrates and the observer resolves.
const ABOVE_FOLD_COUNT = 4

export function MasonryGrid({ children }: MasonryGridProps) {
  const { ref, inView } = useInView<HTMLDivElement>()

  return (
    <div
      ref={ref}
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"
      role="list"
    >
      {Children.map(children, (child, i) => {
        const aboveFold = i < ABOVE_FOLD_COUNT
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
