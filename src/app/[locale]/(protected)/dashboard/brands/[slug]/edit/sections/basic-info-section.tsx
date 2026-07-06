'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller } from 'react-hook-form'
import { ProductTagField } from '@/components/forms/product-tag-field'
import { RequiredLabel } from '@/components/forms/required-label'
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

function FieldError({
  id,
  show,
  text,
}: {
  id: string
  show: boolean
  text: string
}) {
  return show ? (
    <p id={id} className="text-xs text-destructive" aria-live="polite">
      {text}
    </p>
  ) : null
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
    return category
      ? `${category.nameZh} (${category.name})`
      : String(value ?? '')
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
        <RequiredLabel htmlFor="name">{t('fieldBrandName')}</RequiredLabel>
        <Input
          id="name"
          aria-required="true"
          aria-invalid={Boolean(form.formState.errors.name)}
          aria-describedby={
            form.formState.errors.name ? 'name-error' : undefined
          }
          className="min-h-12 bg-card"
          {...form.register('name')}
        />
        <FieldError
          id="name-error"
          show={Boolean(form.formState.errors.name)}
          text={t('requiredFieldError')}
        />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="productType">
        <RequiredLabel htmlFor="productType">
          {t('fieldCategory')}
        </RequiredLabel>
        <Controller
          control={form.control}
          name="productType"
          render={({ field }) => (
            <Select value={field.value ?? ''} onValueChange={field.onChange}>
              <SelectTrigger
                id="productType"
                aria-required="true"
                aria-invalid={Boolean(form.formState.errors.productType)}
                aria-describedby={
                  form.formState.errors.productType
                    ? 'productType-error'
                    : undefined
                }
                className="min-h-12 w-full bg-card"
              >
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
        <FieldError
          id="productType-error"
          show={Boolean(form.formState.errors.productType)}
          text={t('requiredFieldError')}
        />
        <FieldHint
          text={tx(
            'fieldCategoryHint',
            'Used for navigation, search, and filtering',
          )}
        />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="description">
        <RequiredLabel htmlFor="description">
          {t('fieldDescription')}
        </RequiredLabel>
        <Textarea
          id="description"
          aria-required="true"
          aria-invalid={Boolean(form.formState.errors.description)}
          aria-describedby={
            form.formState.errors.description ? 'description-error' : undefined
          }
          className="min-h-28 bg-card"
          {...form.register('description')}
        />
        <FieldError
          id="description-error"
          show={Boolean(form.formState.errors.description)}
          text={t('requiredFieldError')}
        />
        <FieldHint
          text={tx(
            'fieldDescriptionHint',
            'Public description shown on the brand page',
          )}
        />
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
        <FieldHint
          text={tx('fieldFoundingYearHint', 'Shown on the brand page')}
        />
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
        <FieldHint
          text={tx('mitStoryHint', 'Shown on the brand page if provided')}
        />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="productTags">
        <div
          aria-required="true"
          aria-invalid={Boolean(form.formState.errors.productTags)}
          aria-describedby={
            form.formState.errors.productTags ? 'productTags-error' : undefined
          }
        >
          <RequiredLabel>
            {tx('fieldProductTags', 'Product tags')}
          </RequiredLabel>
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
                placeholder={tx(
                  'fieldProductTagsPlaceholder',
                  'Add product tag',
                )}
                removeLabel={tx('removeProductTag', 'Remove tag')}
              />
            )}
          />
        </div>
        <FieldError
          id="productTags-error"
          show={Boolean(form.formState.errors.productTags)}
          text={t('requiredFieldError')}
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
        <FieldHint
          text={tx(
            'cityHint',
            'Your brand will be shown on the map if provided',
          )}
        />
      </DirtyFieldWrapper>

      <DirtyFieldWrapper fieldName="priceRange">
        <RequiredLabel htmlFor="priceRange">
          {tx('fieldPriceRange', 'Price Range')}
        </RequiredLabel>
        <Controller
          control={form.control}
          name="priceRange"
          render={({ field }) => (
            <Select
              value={field.value == null ? '' : String(field.value)}
              onValueChange={field.onChange}
            >
              <SelectTrigger
                id="priceRange"
                aria-required="true"
                aria-invalid={Boolean(form.formState.errors.priceRange)}
                aria-describedby={
                  form.formState.errors.priceRange
                    ? 'priceRange-error'
                    : undefined
                }
                className="min-h-12 w-full bg-card"
              >
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
        <FieldError
          id="priceRange-error"
          show={Boolean(form.formState.errors.priceRange)}
          text={t('requiredFieldError')}
        />
        <FieldHint text={tx('fieldPriceRangeHint', 'Used for filtering')} />
      </DirtyFieldWrapper>
    </section>
  )
}
