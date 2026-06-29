'use client'

import { ChangeEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

type Brand = {
  brandId: string
  brandName: string
  brandSlug: string
  heroImageUrl: string | null
  claimedAt: string
}

type BrandSelectorProps = {
  brands: Brand[]
  selectedSlug: string
}

export function BrandSelector({ brands, selectedSlug }: BrandSelectorProps) {
  const t = useTranslations('dashboard.brandSelector')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSlug =
    selectedSlug || searchParams.get('brand') || brands[0]?.brandSlug || ''
  const selectedBrand =
    brands.find((brand) => brand.brandSlug === currentSlug) ?? brands[0]

  if (brands.length <= 1) {
    return (
      <h1 className="font-heading text-[22px] font-bold leading-tight text-foreground">
        {selectedBrand?.brandName}
      </h1>
    )
  }

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const newSlug = event.target.value
    router.replace(`${pathname}?brand=${newSlug}`)
  }

  return (
    <label className="inline-flex flex-col gap-2">
      <span className="sr-only">{t('label')}</span>
      <select
        className="min-h-12 rounded-lg border border-border bg-background px-3 py-2 font-heading text-[22px] font-bold leading-tight text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={currentSlug}
        onChange={handleChange}
      >
        {brands.map((brand) => (
          <option key={brand.brandId} value={brand.brandSlug}>
            {brand.brandName}
          </option>
        ))}
      </select>
    </label>
  )
}
