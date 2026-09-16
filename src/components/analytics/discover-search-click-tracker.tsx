'use client'

import type { ReactNode } from 'react'
import { trackProductSearchResultClicked } from '@/lib/analytics'

interface DiscoverSearchClickTrackerProps {
  searchId: string
  query: string
  children: ReactNode
}

export function DiscoverSearchClickTracker({ searchId, query, children }: DiscoverSearchClickTrackerProps) {
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element
    const li = target.closest('li[data-brand-slug]')
    if (!li) return

    const brandSlug = li.getAttribute('data-brand-slug')
    const productKey = li.getAttribute('data-product-key')
    if (!brandSlug || !productKey) return

    const position = li.parentElement
      ? Array.from(li.parentElement.children).indexOf(li)
      : 0

    trackProductSearchResultClicked({
      searchId,
      position,
      productKey,
      brandSlug,
      query,
    })
  }

  return <div onClick={handleClick}>{children}</div>
}
