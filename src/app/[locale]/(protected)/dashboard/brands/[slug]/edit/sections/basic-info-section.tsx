'use client'

import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller } from 'react-hook-form'
import { DashboardFormField } from './dashboard-form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { ProductTagField } from '@/components/forms/product-tag-field'
import { RequiredFieldsHint } from '@/components/forms/required-fields-hint'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TAIWAN_CITIES } from '@/lib/constants/taiwan-cities'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

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
    <StandardFormSection id="basic-info">
      <StandardFormStack>
        <h2 className="font-heading text-base font-bold">
          {t('wizardStepBasicInfo')}
        </h2>
        <RequiredFieldsHint />

        <DashboardFormField
          id="name"
          fieldName="name"
          label={t('fieldBrandName')}
          required
          error={
            form.formState.errors.name ? t('requiredFieldError') : undefined
          }
          errorId="name-error"
        >
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
        </DashboardFormField>

        <DashboardFormField
          id="productType"
          fieldName="productType"
          label={t('fieldProductType')}
          description={tx(
            'fieldCategoryHint',
            'Used for navigation, search, and filtering',
          )}
          required
          error={
            form.formState.errors.productType
              ? t('requiredFieldError')
              : undefined
          }
          errorId="productType-error"
        >
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
                  <SelectValue placeholder={t('fieldProductType')}>
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
        </DashboardFormField>

        <DashboardFormField
          id="description"
          fieldName="description"
          label={t('fieldDescription')}
          description={tx(
            'fieldDescriptionHint',
            'Public description shown on the brand page',
          )}
          required
          error={
            form.formState.errors.description
              ? t('requiredFieldError')
              : undefined
          }
          errorId="description-error"
        >
          <Textarea
            id="description"
            aria-required="true"
            aria-invalid={Boolean(form.formState.errors.description)}
            aria-describedby={
              form.formState.errors.description
                ? 'description-error'
                : undefined
            }
            className="min-h-28 bg-card"
            {...form.register('description')}
          />
        </DashboardFormField>

        <DashboardFormField
          id="foundingYear"
          fieldName="foundingYear"
          label={t('fieldFoundingYear')}
          description={tx('fieldFoundingYearHint', 'Shown on the brand page')}
        >
          <Input
            id="foundingYear"
            type="number"
            min={1900}
            max={new Date().getFullYear()}
            className="min-h-12 bg-card"
            {...form.register('foundingYear')}
          />
        </DashboardFormField>

        <DashboardFormField
          id="mitStory"
          fieldName="mitStory"
          label={t('mitStoryLabel')}
          description={tx(
            'mitStoryHint',
            'Shown on the brand page if provided',
          )}
        >
          <Textarea
            id="mitStory"
            rows={5}
            placeholder={t('mitStoryPlaceholder')}
            className="min-h-28 bg-card"
            {...form.register('mitStory')}
          />
        </DashboardFormField>

        <DashboardFormField
          id="productTags"
          fieldName="productTags"
          label={tx('fieldProductTags', 'Product tags')}
          description={tx('productTagsMax', 'Up to 5 product tags')}
          required
          error={
            form.formState.errors.productTags
              ? t('requiredFieldError')
              : undefined
          }
          errorId="productTags-error"
        >
          <div
            aria-required="true"
            aria-invalid={Boolean(form.formState.errors.productTags)}
            aria-describedby={
              form.formState.errors.productTags
                ? 'productTags-error'
                : undefined
            }
          >
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
        </DashboardFormField>

        <DashboardFormField
          id="city"
          fieldName="city"
          label={t('city')}
          description={tx(
            'cityHint',
            'Your brand will be shown on the map if provided',
          )}
        >
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
        </DashboardFormField>

        <DashboardFormField
          id="priceRange"
          fieldName="priceRange"
          label={tx('fieldPriceRange', 'Price Range')}
          description={tx('fieldPriceRangeHint', 'Used for filtering')}
          required
          error={
            form.formState.errors.priceRange
              ? t('requiredFieldError')
              : undefined
          }
          errorId="priceRange-error"
        >
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
                  <SelectValue
                    placeholder={tx('fieldPriceRangeUnset', 'Unset')}
                  >
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
        </DashboardFormField>
      </StandardFormStack>
    </StandardFormSection>
  )
}
