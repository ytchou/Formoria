'use client'

import { usePathname } from 'next/navigation'
import { Suspense } from 'react'
import { SearchInput } from '@/components/brands/search-input'

function NavSearchInputInner() {
  const pathname = usePathname()
  const isBrandsPage = pathname === '/brands'

  return (
    <SearchInput
      redirectTo={isBrandsPage ? undefined : '/brands'}
      placeholder="搜尋品牌..."
      className="max-w-xl"
    />
  )
}

export function NavSearchInput() {
  return (
    <Suspense>
      <NavSearchInputInner />
    </Suspense>
  )
}
