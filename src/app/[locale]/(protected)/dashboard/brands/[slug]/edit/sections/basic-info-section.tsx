'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller } from 'react-hook-form'
import { ProductTagField } from '@/components/forms/product-tag-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { TAIWAN_CITIES } from '@/lib/constants/taiwan-cities'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { useDirtyFields } from '../dirty-fields-context'

function FieldHint({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>
}

function DirtyFieldWrapper({
  fieldName,
  children,
}: {
  fieldName: keyof BrandEditFormValues
  children: ReactNode
}) {
  const dirtyFields = useDirtyFields()
  const isDirty = Boolean(dirtyFields[fieldName])
  return (
    <div
      className={cn(
        'space-y-2 rounded-md border-l-2 pl-3 transition-colors',
        isDirty ? 'border-l-amber-400' : 'border-l-transparent',
      )}
    >
      {children}
    </div>
  )
}

export function BasicInfoSection({
  form,
  productTagSuggestions = [],
}: {
  form: UseFormReturn<BrandEditFormValues>
  productTagSuggestions?: string[]
}) {
  const t = useTranslations('dashboard.edit')
  const tCities = useTranslations('cities')
  const tx = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback)
  const getCategoryLabel = (value: unknown) => {
    const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === value)
    return category ? `${category.nameZh} (${category.name})` : String(value ?? '')
  }
  const getCityLabel = (value: unknown) => {
    const city = TAIWAN_CITIES.find((item) => item.slug === value)
    return city ? tCities(city.slug) : String(value ?? '')
  }
  const getPriceRangeLabel = (value: unknown) => {
    const labels: Record<string, string> = {
      '1': `$ · ${t('fieldPriceRangeBudget')}`,
      '2': `$$ · ${t('fieldPriceRangeMidRange')}`,
      '3': `$$$ · ${t('fieldPriceRangePremium')}`,
    }
    return labels[String(value)] ?? String(value ?? '')
  }
  return (
    <section id="basic-info" className="space-y-4">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionBasicInfo')}
      </h2>

      <DirtyFieldWrapper fieldName="name">
        <Label htmlFor="name">{t('fieldBrandName')}</Label>
        <Input id="name" className="min-h-12 bg-card" {...form.register('name')} />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="productType">
        <Label htmlFor="productType">{t('fieldCategory')}</Label>
        <Controller
          control={form.control}
          name="productType"
          render={({ field }) => (
            <Select value={field.value ?? ''} onValueChange={field.onChange}>
              <SelectTrigger id="productType" className="min-h-12 w-full bg-card">
                <SelectValue placeholder={t('fieldCategory')}>
                  {getCategoryLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_TYPE_CATEGORIES.map((category) => (
                  <SelectItem key={category.slug} value={category.slug}>
                    {category.nameZh} ({category.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FieldHint text={tx('fieldCategoryHint', 'Used for navigation, search, and filtering')} />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="description">
        <Label htmlFor="description">{t('fieldDescription')}</Label>
        <Textarea
          id="description"
          className="min-h-28 bg-card"
          {...form.register('description')}
        />
        <FieldHint text={tx('fieldDescriptionHint', 'Public description shown on the brand page')} />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="foundingYear">
        <Label htmlFor="foundingYear">{t('fieldFoundingYear')}</Label>
        <Input
          id="foundingYear"
          type="number"
          min={1900}
          max={new Date().getFullYear()}
          className="min-h-12 bg-card"
          {...form.register('foundingYear')}
        />
        <FieldHint text={tx('fieldFoundingYearHint', 'Shown on the brand page')} />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="mitStory">
        <Label htmlFor="mitStory">{t('mitStoryLabel')}</Label>
        <Textarea
          id="mitStory"
          rows={5}
          placeholder={t('mitStoryPlaceholder')}
          className="min-h-28 bg-card"
          {...form.register('mitStory')}
        />
        <FieldHint text={tx('mitStoryHint', 'Shown on the brand page if provided')} />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="productTags">
        <Label>{tx('fieldProductTags', 'Product tags')}</Label>
        <p className="text-xs text-muted-foreground">
          {tx('productTagsMax', 'Up to 5 product tags')}
        </p>
        <Controller
          control={form.control}
          name="productTags"
          render={({ field }) => (
            <ProductTagField
              value={field.value ?? []}
              onChange={field.onChange}
              suggestions={productTagSuggestions}
              inputLabel={tx('fieldProductTags', 'Product tags')}
              placeholder={tx('fieldProductTagsPlaceholder', 'Add product tag')}
              removeLabel={tx('removeProductTag', 'Remove tag')}
            />
          )}
        />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="city">
        <Label htmlFor="city">{t('city')}</Label>
        <Controller
          control={form.control}
          name="city"
          render={({ field }) => (
            <Select value={field.value ?? ''} onValueChange={field.onChange}>
              <SelectTrigger id="city" className="min-h-12 w-full bg-card">
                <SelectValue placeholder={t('cityPlaceholder')}>
                  {getCityLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TAIWAN_CITIES.map((city) => (
                  <SelectItem key={city.slug} value={city.slug}>
                    {tCities(city.slug)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FieldHint text={tx('cityHint', 'Your brand will be shown on the map if provided')} />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="priceRange">
        <Label htmlFor="priceRange">{tx('fieldPriceRange', 'Price Range')}</Label>
        <Controller
          control={form.control}
          name="priceRange"
          render={({ field }) => (
            <Select
              value={field.value == null ? '' : String(field.value)}
              onValueChange={field.onChange}
            >
              <SelectTrigger id="priceRange" className="min-h-12 w-full bg-card">
                <SelectValue placeholder={tx('fieldPriceRangeUnset', 'Unset')}>
                  {getPriceRangeLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{getPriceRangeLabel('1')}</SelectItem>
                <SelectItem value="2">{getPriceRangeLabel('2')}</SelectItem>
                <SelectItem value="3">{getPriceRangeLabel('3')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <FieldHint text={tx('fieldPriceRangeHint', 'Used for filtering')} />
      </DirtyFieldWrapper>
    </section>
  )
}
