'use client'

import { usePathname } from '@/i18n/navigation'
import { Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { SearchInput } from '@/components/brands/search-input'

function NavSearchInputInner() {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const isBrandsPage = pathname === '/brands'

  return (
    <SearchInput
      redirectTo={isBrandsPage ? undefined : '/brands'}
      placeholder={t('searchPlaceholder')}
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
