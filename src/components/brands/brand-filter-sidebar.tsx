'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { trackCategoryFilterApplied } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { useFilterParams } from '@/hooks/use-filter-params'
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
import type { BrandFilters, TaxonomyTag } from '@/lib/types'

type VerificationFilterValue = NonNullable<BrandFilters['verificationFilter']>

type CategoryOption = {
  slug: string
  name: string
  nameZh: string | null
}

type BrandFilterSidebarProps = {
  categories: CategoryOption[]
  valueTags: TaxonomyTag[]
  className?: string
  showSummary?: boolean
}

type BrandFilterDrawerProps = BrandFilterSidebarProps & {
  totalCount: number
}

const verificationOptions: VerificationFilterValue[] = ['all', 'mit-verified', 'owned']

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
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wider text-foreground"
      >
        {title}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform',
            !open && '-rotate-90'
          )}
          aria-hidden="true"
        />
      </button>
      {open && children}
    </section>
  )
}

export function BrandFilterSidebar({
  categories,
  valueTags,
  className,
  showSummary = true,
}: BrandFilterSidebarProps) {
  const locale = useLocale()
  const t = useTranslations('brands.filters')
  const verificationT = useTranslations('brands.verificationFilter')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { selectedSlugs } = useFilterParams()

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

  const selectedTags = useMemo(() => new Set(selectedSlugs), [selectedSlugs])
  const activeCount =
    activeCategories.size +
    (activeVerification !== 'all' ? 1 : 0) +
    selectedSlugs.length
  const useZh = locale === 'zh-TW'

  function categoryLabel(category: CategoryOption) {
    return useZh ? category.nameZh ?? category.name : category.name
  }

  function tagLabel(tag: TaxonomyTag) {
    return useZh ? tag.nameZh ?? tag.name : tag.name
  }

  function toggleCategory(slug: string, checked: boolean) {
    const next = new Set(activeCategories)
    if (checked) {
      next.add(slug)
      trackCategoryFilterApplied(slug)
    } else {
      next.delete(slug)
    }

    router.replace(
      updateParamUrl(pathname, searchParams, (params) => {
        if (next.size > 0) {
          params.set('category', Array.from(next).join(','))
        } else {
          params.delete('category')
        }
      }),
      { scroll: false }
    )
  }

  function setVerification(value: VerificationFilterValue) {
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
  }

  function toggleTag(slug: string, checked: boolean) {
    const next = new Set(selectedSlugs)
    if (checked) {
      next.add(slug)
    } else {
      next.delete(slug)
    }

    router.replace(
      updateParamUrl(pathname, searchParams, (params) => {
        if (next.size > 0) {
          params.set('tags', Array.from(next).join(','))
        } else {
          params.delete('tags')
        }
      }),
      { scroll: false }
    )
  }

  function clearAll() {
    router.replace(
      updateParamUrl(pathname, searchParams, (params) => {
        params.delete('category')
        params.delete('verification')
        params.delete('tags')
      }),
      { scroll: false }
    )
  }

  return (
    <div className={cn('space-y-6', className)}>
      {showSummary && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t('appliedCount', { count: activeCount })}
          </p>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-sm inline-link"
            >
              {t('clearAll')}
            </button>
          )}
        </div>
      )}

      <FilterSection title={t('category')}>
        <div className="space-y-2">
          {categories.map((category) => {
            const checked = activeCategories.has(category.slug)
            return (
              <Label
                key={category.slug}
                className={cn(
                  'cursor-pointer justify-between gap-3 text-sm font-normal text-muted-foreground transition-colors hover:text-foreground',
                  checked && 'text-primary'
                )}
              >
                <span>{categoryLabel(category)}</span>
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value: boolean) => toggleCategory(category.slug, value)}
                  aria-label={categoryLabel(category)}
                />
              </Label>
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

      {valueTags.length > 0 && (
        <>
          <Separator />
          <FilterSection title={t('brandValues')}>
            <div className="space-y-2">
              {valueTags.map((tag) => {
                const checked = selectedTags.has(tag.slug)
                return (
                  <Label
                    key={tag.slug}
                    className={cn(
                      'cursor-pointer justify-between gap-3 text-sm font-normal text-muted-foreground transition-colors hover:text-foreground',
                      checked && 'text-primary'
                    )}
                  >
                    <span>{tagLabel(tag)}</span>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value: boolean) => toggleTag(tag.slug, value)}
                      aria-label={tagLabel(tag)}
                    />
                  </Label>
                )
              })}
            </div>
          </FilterSection>
        </>
      )}
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
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
        checked && 'font-medium text-primary'
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-primary"
      />
      <span>{label}</span>
    </label>
  )
}

export function BrandFilterDrawer({
  categories,
  valueTags,
  totalCount,
}: BrandFilterDrawerProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('brands.filters')
  const searchParams = useSearchParams()
  const activeCategories = parseCommaParam(searchParams.get('category'))
  const activeVerification = searchParams.get('verification')
  const activeTags = parseCommaParam(searchParams.get('tags'))
  const activeCount =
    activeCategories.length +
    (activeVerification === 'mit-verified' || activeVerification === 'owned' ? 1 : 0) +
    activeTags.length

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" className="gap-2 lg:hidden" />
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
            valueTags={valueTags}
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

  function clearAll() {
    router.replace(
      updateParamUrl(pathname, searchParams, (params) => {
        params.delete('category')
        params.delete('verification')
        params.delete('tags')
      }),
      { scroll: false }
    )
    onClear()
  }

  return (
    <button
      type="button"
      onClick={clearAll}
      className="mx-auto text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {t('clearAll')}
    </button>
  )
}
