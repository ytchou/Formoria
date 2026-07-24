'use client'

import { Children, type ReactNode } from 'react'
import { useInView } from '@/hooks/use-in-view'

interface MasonryGridProps { children: ReactNode }

export function MasonryGrid({ children }: MasonryGridProps) {
  const { ref, inView } = useInView<HTMLDivElement>()

  return (
    <div
      ref={ref}
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"
      role="list"
    >
      {Children.map(children, (child, i) => (
        <div
          role="listitem"
          className={inView ? 'animate-reveal-up' : 'opacity-0'}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  )
}
