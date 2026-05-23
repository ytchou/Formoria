'use client'

import Masonry from 'react-masonry-css'
import { Children, type ReactNode } from 'react'

const breakpointColumns = { default: 4, 1024: 4, 640: 2, 0: 1 }

interface MasonryGridProps { children: ReactNode }

export function MasonryGrid({ children }: MasonryGridProps) {
  return (
    <Masonry
      breakpointCols={breakpointColumns}
      className="masonry-grid"
      columnClassName="masonry-grid_column"
      role="list"
    >
      {Children.map(children, (child) => (
        <div role="listitem">{child}</div>
      ))}
    </Masonry>
  )
}
