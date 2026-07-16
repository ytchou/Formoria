'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Controller, useFormContext } from 'react-hook-form'
import { DashboardFormField } from './dashboard-form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { ProductTagField } from '@/components/forms/product-tag-field'
import { RequiredFieldsHint } from '@/components/forms/required-fields-hint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { TAIWAN_CITIES } from '@/lib/constants/taiwan-cities'
import type { BrandWizardCommonValues } from '@/lib/schemas/brand-wizard'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

type RequiredBasicField =
  | 'name'
  | 'productType'
  | 'description'
  | 'productTags'
  | 'priceRange'

export function BrandBasicInfoSection({
  productTagSuggestions = [],
  requiredFields = {},
  afterRomanizedName,
  suggestName,
}: {
  productTagSuggestions?: string[]
  requiredFields?: Partial<Record<RequiredBasicField, boolean>>
  afterRomanizedName?: ReactNode
  suggestName?: (name: string) => Promise<{
    changed: boolean
    suggestion?: string | null
  }>
}) {
  const form = useFormContext<BrandWizardCommonValues>()
  const t = useTranslations('dashboard.edit')
  const tSubmit = useTranslations('submit')
  const tCities = useTranslations('cities')
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const nameBlurRequestRef = useRef(0)
  const nameRegistration = form.register('name')
  const tx = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback)
  const getPriceRangeLabel = (value: unknown) => {
    const labels: Record<string, string> = {
      '1': `$ · ${t('fieldPriceRangeBudget')}`,
      '2': `$$ · ${t('fieldPriceRangeMidRange')}`,
      '3': `$$$ · ${t('fieldPriceRangePremium')}`,
    }
    return labels[String(value)] ?? String(value ?? '')
  }

  const handleNameBlur = async () => {
    const name = form.getValues('name')?.trim()
    if (!name || !suggestName) return
    const requestId = ++nameBlurRequestRef.current
    try {
      const result = await suggestName(name)
      if (requestId !== nameBlurRequestRef.current) return
      setNameSuggestion(
        result.changed && result.suggestion ? result.suggestion : null,
      )
    } catch {
      if (requestId === nameBlurRequestRef.current) setNameSuggestion(null)
    }
  }
  return (
    <StandardFormSection id="basic-info">
      <StandardFormStack>
        <h2 className="type-section-title">
          {t('wizardStepBasicInfo')}
        </h2>
        <RequiredFieldsHint />

        <DashboardFormField
          id="name"
          fieldName="name"
          label={t('fieldBrandName')}
          required={Boolean(requiredFields.name)}
          error={
            form.formState.errors.name ? t('requiredFieldError') : undefined
          }
          errorId="name-error"
        >
          <Input
            id="name"
            aria-required={Boolean(requiredFields.name)}
            aria-invalid={Boolean(form.formState.errors.name)}
            aria-describedby={
              form.formState.errors.name ? 'name-error' : undefined
            }
            className="min-h-12 bg-card"
            {...nameRegistration}
            onBlur={(event) => {
              nameRegistration.onBlur(event)
              void handleNameBlur()
            }}
            onChange={(event) => {
              setNameSuggestion(null)
              nameRegistration.onChange(event)
            }}
          />
          {nameSuggestion ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
              <span>
                {tSubmit('ownerForm.suggestedName')}{' '}
                <strong>{nameSuggestion}</strong>
              </span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  form.setValue('name', nameSuggestion, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                  setNameSuggestion(null)
                }}
              >
                {tSubmit('ownerForm.applySuggestion')}
              </Button>
            </div>
          ) : null}
        </DashboardFormField>

        <DashboardFormField
          id="romanizedName"
          fieldName="romanizedName"
          label={tSubmit('ownerForm.romanizedNameLabel')}
          description={tSubmit('ownerForm.romanizedNameHint')}
          error={form.formState.errors.romanizedName?.message}
          errorId="romanizedName-error"
        >
          <Input
            id="romanizedName"
            autoComplete="off"
            placeholder={tSubmit('ownerForm.romanizedNamePlaceholder')}
            aria-invalid={Boolean(form.formState.errors.romanizedName)}
            aria-describedby={
              form.formState.errors.romanizedName
                ? 'romanizedName-error'
                : undefined
            }
            className="min-h-12 bg-card"
            {...form.register('romanizedName')}
          />
        </DashboardFormField>

        {afterRomanizedName}

        <DashboardFormField
          id="productType"
          fieldName="productType"
          label={t('fieldProductType')}
          description={tx(
            'fieldCategoryHint',
            'Used for navigation, search, and filtering',
          )}
          required={Boolean(requiredFields.productType)}
          error={
            form.formState.errors.productType
              ? t('requiredFieldError')
              : undefined
          }
          errorId="productType-error"
        >
          <NativeSelect
            id="productType"
            aria-required={Boolean(requiredFields.productType)}
            aria-invalid={Boolean(form.formState.errors.productType)}
            aria-describedby={
              form.formState.errors.productType
                ? 'productType-error'
                : undefined
            }
            className="min-h-12 w-full bg-card"
            {...form.register('productType', {
              setValueAs: (value) => (value === '' ? undefined : value),
            })}
          >
            <option value="">{t('fieldProductType')}</option>
            {PRODUCT_TYPE_CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.nameZh} ({category.name})
              </option>
            ))}
          </NativeSelect>
        </DashboardFormField>

        <DashboardFormField
          id="description"
          fieldName="description"
          label={t('fieldDescription')}
          description={tx(
            'fieldDescriptionHint',
            'Public description shown on the brand page',
          )}
          required={Boolean(requiredFields.description)}
          error={
            form.formState.errors.description
              ? t('requiredFieldError')
              : undefined
          }
          errorId="description-error"
        >
          <Textarea
            id="description"
            aria-required={Boolean(requiredFields.description)}
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
          required={Boolean(requiredFields.productTags)}
          error={
            form.formState.errors.productTags
              ? t('requiredFieldError')
              : undefined
          }
          errorId="productTags-error"
        >
          <div
            aria-required={Boolean(requiredFields.productTags)}
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
          <NativeSelect
            id="city"
            className="min-h-12 w-full bg-card"
            {...form.register('city', {
              setValueAs: (value) => (value === '' ? undefined : value),
            })}
          >
            <option value="">{t('cityPlaceholder')}</option>
            {TAIWAN_CITIES.map((city) => (
              <option key={city.slug} value={city.slug}>
                {tCities(city.slug)}
              </option>
            ))}
          </NativeSelect>
        </DashboardFormField>

        <DashboardFormField
          id="priceRange"
          fieldName="priceRange"
          label={tx('fieldPriceRange', 'Price Range')}
          description={tx('fieldPriceRangeHint', 'Used for filtering')}
          required={Boolean(requiredFields.priceRange)}
          error={
            form.formState.errors.priceRange
              ? t('requiredFieldError')
              : undefined
          }
          errorId="priceRange-error"
        >
          <NativeSelect
            id="priceRange"
            aria-required={Boolean(requiredFields.priceRange)}
            aria-invalid={Boolean(form.formState.errors.priceRange)}
            aria-describedby={
              form.formState.errors.priceRange ? 'priceRange-error' : undefined
            }
            className="min-h-12 w-full bg-card"
            {...form.register('priceRange', {
              setValueAs: (value) => (value === '' ? undefined : Number(value)),
            })}
          >
            <option value="">{tx('fieldPriceRangeUnset', 'Unset')}</option>
            <option value="1">{getPriceRangeLabel('1')}</option>
            <option value="2">{getPriceRangeLabel('2')}</option>
            <option value="3">{getPriceRangeLabel('3')}</option>
          </NativeSelect>
        </DashboardFormField>
      </StandardFormStack>
    </StandardFormSection>
  )
}
