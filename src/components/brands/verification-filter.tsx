'use client'

import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { BrandFilters } from '@/lib/types'

type VerificationFilterValue = NonNullable<BrandFilters['verificationFilter']>

interface VerificationFilterProps {
  active: VerificationFilterValue
}

export function VerificationFilter({ active }: VerificationFilterProps) {
  const t = useTranslations('brands.verificationFilter')
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const options: Array<{ value: VerificationFilterValue; label: string }> = [
    { value: 'all', label: t('all') },
    { value: 'verified', label: t('verified') },
    { value: 'community', label: t('community') },
  ]

  function handleClick(value: VerificationFilterValue) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('verification', value)
    params.delete('page')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex gap-2 overflow-x-auto snap-x pb-2 scrollbar-none">
      {options.map((option) => {
        const isActive = active === option.value

        return (
          <button
            key={option.value}
            type="button"
            data-active={isActive ? 'true' : 'false'}
            onClick={() => handleClick(option.value)}
            className={`shrink-0 snap-start rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-foreground text-background'
                : 'border border-border bg-card text-foreground hover:bg-secondary'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
