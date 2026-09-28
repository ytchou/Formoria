'use client'

import { usePathname } from '@/i18n/navigation'
import { Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { ProductSearchBoxCompact } from '@/components/products/product-situation-search-form'
import { routes } from '@/lib/routes'

function NavSearchInputInner() {
  const pathname = usePathname()
  const t = useTranslations('nav')
  if (pathname === routes.brands() || pathname === routes.discover()) return null

  return (
    <ProductSearchBoxCompact
      src="nav"
      label={t("searchAria")}
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
