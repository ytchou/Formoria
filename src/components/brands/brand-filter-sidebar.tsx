'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { trackCategoryFilterApplied } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { BrandFilters } from '@/lib/types'

type VerificationFilterValue = NonNullable<BrandFilters['verificationFilter']>

type CategoryOption = {
  slug: string
  name: string
  nameZh: string | null
}

type SubcategoryOption = {
  slug: string
  label: string
  count: number
}

type BrandFilterSidebarProps = {
  categories: CategoryOption[]
  subcategories?: SubcategoryOption[]
  activeSubSlugs?: string[]
  className?: string
  showSummary?: boolean
}

type BrandFilterDrawerProps = BrandFilterSidebarProps & {
  totalCount: number
}

const verificationOptions: VerificationFilterValue[] = ['all', 'mit-verified', 'owned']
const priceRangeOptions = [1, 2, 3] as const
const filterOptionClassName =
  'flex cursor-pointer items-center gap-2 type-card-description transition-colors hover:text-foreground'

function parseCommaParam(value: string | null): string[] {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function updateParamUrl(
  pathname: string,
  searchParams: { toString(): string },
  updates: (params: URLSearchParams) => void
) {
  const params = new URLSearchParams(searchParams.toString())
  updates(params)
  params.delete('page')
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

function FilterSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)

  return (
    <section className="space-y-3">
      <Button
        type="button"
        variant="ghost"
        size="compact"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-full justify-between text-left"
      >
        <span className="type-eyebrow-foreground">{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform',
            !open && '-rotate-90'
          )}
          aria-hidden="true"
        />
      </Button>
      {open && children}
    </section>
  )
}

export function BrandFilterSidebar({
  categories,
  subcategories = [],
  activeSubSlugs = [],
  className,
  showSummary = true,
}: BrandFilterSidebarProps) {
  const locale = useLocale()
  const t = useTranslations('brands.filters')
  const verificationT = useTranslations('brands.verificationFilter')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeCategories = useMemo(
    () => new Set(parseCommaParam(searchParams.get('category'))),
    [searchParams]
  )
  const activeVerification = (
    searchParams.get('verification') === 'mit-verified' ||
    searchParams.get('verification') === 'owned'
      ? searchParams.get('verification')
      : 'all'
  ) as VerificationFilterValue
  const activePriceRanges = useMemo(
    () => new Set(parseCommaParam(searchParams.get('price')).map(Number)),
    [searchParams]
  )
  const activeSubcategories = new Set(activeSubSlugs)

  const activeCount =
    activeCategories.size +
    activeSubSlugs.length +
    activePriceRanges.size +
    (activeVerification !== 'all' ? 1 : 0)
  const useZh = locale === 'zh-TW'
  const [, startTransition] = useTransition()

  function categoryLabel(category: CategoryOption) {
    return useZh ? category.nameZh ?? category.name : category.name
  }

  function toggleCategory(slug: string, checked: boolean) {
    const next = new Set(activeCategories)
    if (checked) {
      next.add(slug)
      trackCategoryFilterApplied(slug)
    } else {
      next.delete(slug)
    }

    startTransition(() => {
      router.replace(
        updateParamUrl(pathname, searchParams, (params) => {
          if (next.size > 0) {
            params.set('category', Array.from(next).join(','))
          } else {
            params.delete('category')
          }
          if (!checked || next.size > 1) {
            params.delete('sub')
          }
        }),
        { scroll: false }
      )
    })
  }

  function toggleSubcategory(slug: string, checked: boolean) {
    const next = new Set(activeSubcategories)
    if (checked) next.add(slug)
    else next.delete(slug)

    startTransition(() => {
      router.replace(
        updateParamUrl(pathname, searchParams, (params) => {
          if (next.size > 0) params.set('sub', Array.from(next).join(','))
          else params.delete('sub')
        }),
        { scroll: false }
      )
    })
  }

  function setVerification(value: VerificationFilterValue) {
    startTransition(() => {
      router.replace(
        updateParamUrl(pathname, searchParams, (params) => {
          if (value === 'all') {
            params.delete('verification')
          } else {
            params.set('verification', value)
          }
        }),
        { scroll: false }
      )
    })
  }

  function togglePriceRange(value: number, checked: boolean) {
    const next = new Set(activePriceRanges)
    if (checked) next.add(value)
    else next.delete(value)

    startTransition(() => {
      router.replace(
        updateParamUrl(pathname, searchParams, (params) => {
          if (next.size > 0) params.set('price', Array.from(next).sort().join(','))
          else params.delete('price')
        }),
        { scroll: false }
      )
    })
  }

  function clearAll() {
    startTransition(() => {
      router.replace(
        updateParamUrl(pathname, searchParams, (params) => {
          params.delete('category')
          params.delete('sub')
          params.delete('price')
          params.delete('verification')
        }),
        { scroll: false }
      )
    })
  }

  return (
    <div className={cn('space-y-6', className)}>
      {showSummary && (
        <div className="flex items-center justify-between gap-3">
          <p className="type-card-description">
            {t('appliedCount', { count: activeCount })}
          </p>
          {activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="chip"
              onClick={clearAll}
              className="inline-link"
            >
              {t('clearAll')}
            </Button>
          )}
        </div>
      )}

      <FilterSection title={t('category')}>
        <div className="space-y-2">
          {categories.map((category) => {
            const checked = activeCategories.has(category.slug)
            return (
              <div key={category.slug} className="space-y-2">
                <Label
                  className={cn(filterOptionClassName, checked && 'text-primary')}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value: boolean) => toggleCategory(category.slug, value)}
                    aria-label={categoryLabel(category)}
                  />
                  <span>{categoryLabel(category)}</span>
                </Label>
                {checked && subcategories.length > 0 && (
                  <div className="ml-6 flex flex-wrap gap-2">
                    {subcategories.map((subcategory) => {
                      const subcategoryChecked = activeSubcategories.has(subcategory.slug)
                      return (
                        <Button
                          key={subcategory.slug}
                          type="button"
                          variant="secondary"
                          shape="pill"
                          size="chip"
                          aria-pressed={subcategoryChecked}
                          onClick={() => toggleSubcategory(subcategory.slug, !subcategoryChecked)}
                          className={cn(
                            subcategoryChecked &&
                              'border-primary bg-primary text-primary-foreground'
                          )}
                        >
                          {subcategory.label}{' '}
                          <span className={cn(subcategoryChecked ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{subcategory.count}</span>
                        </Button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </FilterSection>

      <Separator />

      <FilterSection title={t('priceRange')}>
        <div className="flex flex-wrap gap-2">
          {priceRangeOptions.map((value) => {
            const checked = activePriceRanges.has(value)
            const label = '$'.repeat(value)
            return (
              <Button
                key={value}
                type="button"
                variant="secondary"
                shape="pill"
                size="chip"
                aria-pressed={checked}
                onClick={() => togglePriceRange(value, !checked)}
                className={cn(checked && 'border-primary bg-primary text-primary-foreground')}
              >
                {label}
              </Button>
            )
          })}
        </div>
      </FilterSection>

      <Separator />

      <FilterSection title={t('brandStatus')}>
        <div role="radiogroup" aria-label={t('brandStatus')} className="space-y-2">
          {verificationOptions.map((value) => (
            <FilterRadio
              key={value}
              name="brand-verification"
              checked={activeVerification === value}
              label={verificationT(value)}
              onChange={() => setVerification(value)}
            />
          ))}
        </div>
      </FilterSection>

    </div>
  )
}

function FilterRadio({
  name,
  checked,
  label,
  onChange,
}: {
  name: string
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <Label
      className={cn(
        filterOptionClassName,
        checked && 'font-medium text-primary'
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="h-4 w-4 accent-primary" />
      <span>{label}</span>
    </Label>
  )
}

export function BrandFilterDrawer({
  categories,
  subcategories = [],
  activeSubSlugs = [],
  totalCount,
}: BrandFilterDrawerProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('brands.filters')
  const searchParams = useSearchParams()
  const activeCategories = parseCommaParam(searchParams.get('category'))
  const activeVerification = searchParams.get('verification')
  const activePriceRanges = parseCommaParam(searchParams.get('price'))
  const activeCount =
    activeCategories.length +
    activeSubSlugs.length +
    activePriceRanges.length +
    (activeVerification === 'mit-verified' || activeVerification === 'owned' ? 1 : 0)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="secondary" className="gap-2 lg:hidden" />
        }
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {t('trigger', { count: activeCount })}
      </SheetTrigger>
      <SheetContent side="left" className="w-[86vw] max-w-sm gap-0 p-0" showCloseButton>
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <BrandFilterSidebar
            categories={categories}
            subcategories={subcategories}
            activeSubSlugs={activeSubSlugs}
            showSummary={false}
          />
        </div>
        <SheetFooter className="sticky bottom-0 border-t border-border bg-popover">
          <Button type="button" className="w-full" onClick={() => setOpen(false)}>
            {t('showResults', { count: totalCount })}
          </Button>
          <MobileClearAll onClear={() => setOpen(false)} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function MobileClearAll({ onClear }: { onClear: () => void }) {
  const t = useTranslations('brands.filters')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  function clearAll() {
    startTransition(() => {
      router.replace(
        updateParamUrl(pathname, searchParams, (params) => {
          params.delete('category')
          params.delete('sub')
          params.delete('price')
          params.delete('verification')
        }),
        { scroll: false }
      )
    })
    onClear()
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="chip"
      onClick={clearAll}
      className="mx-auto type-card-description underline-offset-2 hover:text-foreground hover:underline"
    >
      {t('clearAll')}
    </Button>
  )
}
