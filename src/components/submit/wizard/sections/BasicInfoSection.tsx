'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Controller } from 'react-hook-form'
import { suggestCleanName } from '@/app/[locale]/submit/actions'
import { FormField } from '@/components/forms/form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { ProductTagField } from '@/components/forms/product-tag-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { TAIWAN_CITIES } from '@/lib/constants/taiwan-cities'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { useSubmissionWizard } from '../submission-wizard-context'

export function BasicInfoSection() {
  const t = useTranslations('submit')
  const tDashboard = useTranslations('dashboard.edit')
  const tCities = useTranslations('cities')
  const { form, productTagSuggestions } = useSubmissionWizard()
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const nameBlurRequestRef = useRef(0)
  const nameRegistration = form.register('name')

  const handleNameBlur = async () => {
    const name = form.getValues('name')
    if (!name) return

    const requestId = ++nameBlurRequestRef.current
    try {
      const result = await suggestCleanName(name)
      if (requestId !== nameBlurRequestRef.current) return
      setNameSuggestion(
        result.changed && result.suggestion ? result.suggestion : null,
      )
    } catch {
      if (requestId === nameBlurRequestRef.current) {
        setNameSuggestion(null)
      }
    }
  }

  return (
    <StandardFormSection id="submission-basic-info">
      <StandardFormStack>
        <h2 className="type-section-title">
          {t('submissionWizard.basicInfoHeading')}
        </h2>

        <FormField
          id="submission-name"
          label={t('ownerForm.brandNameLabel')}
          description={t('ownerForm.brandNameHint')}
          error={
            form.formState.errors.name
              ? t('validation.nameMinLength')
              : undefined
          }
          required
        >
          <Input
            id="submission-name"
            type="text"
            autoComplete="organization"
            placeholder={t('ownerForm.brandNamePlaceholder')}
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
                {t('ownerForm.suggestedName')}{' '}
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
                {t('ownerForm.applySuggestion')}
              </Button>
            </div>
          ) : null}
        </FormField>

        <FormField
          id="submission-website"
          label={t('ownerForm.websiteLabel')}
          description={t('ownerForm.websiteHint')}
          error={
            form.formState.errors.website
              ? t('validation.urlInvalid')
              : undefined
          }
          required
        >
          <Input
            id="submission-website"
            type="url"
            autoComplete="url"
            placeholder={t('ownerForm.websitePlaceholder')}
            {...form.register('website')}
          />
        </FormField>

        <FormField
          id="submission-description"
          label={t('ownerForm.descriptionLabel')}
          description={t('ownerForm.descriptionHint')}
          error={
            form.formState.errors.description
              ? t('validation.descriptionRequired')
              : undefined
          }
          required
        >
          <Textarea
            id="submission-description"
            rows={5}
            placeholder={t('ownerForm.descriptionPlaceholder')}
            {...form.register('description')}
          />
        </FormField>

        <FormField
          id="submission-product-type"
          label={t('fields.productTypes')}
          description={t('fields.productTypesHint')}
        >
          <NativeSelect
            id="submission-product-type"
            {...form.register('productType', {
              setValueAs: (value) => (value === '' ? undefined : value),
            })}
          >
            <option value="">{t('fields.categoryPlaceholder')}</option>
            {PRODUCT_TYPE_CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.nameZh} ({category.name})
              </option>
            ))}
          </NativeSelect>
        </FormField>

        <FormField
          id="submission-founding-year"
          label={tDashboard('fieldFoundingYear')}
        >
          <Input
            id="submission-founding-year"
            type="number"
            min={1900}
            max={new Date().getFullYear()}
            {...form.register('foundingYear', {
              setValueAs: (value) =>
                value === '' ? undefined : Number(value),
            })}
          />
        </FormField>

        <FormField
          id="productTags"
          label={t('fields.tags')}
          description={t('fields.tagsHint')}
          error={
            form.formState.errors.productTags
              ? t('validation.tagsMax')
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
                inputLabel={t('fields.tags')}
                placeholder={t('fields.tagsInputPlaceholder')}
                removeLabel={tDashboard('removeProductTag')}
                maxLabel={tDashboard('productTagsMax')}
              />
            )}
          />
        </FormField>

        <FormField
          id="submission-city"
          label={t('city')}
          description={t('ownerForm.cityHint')}
        >
          <NativeSelect
            id="submission-city"
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
        </FormField>

        <FormField
          id="submission-price-range"
          label={tDashboard('fieldPriceRange')}
        >
          <NativeSelect
            id="submission-price-range"
            {...form.register('priceRange', {
              setValueAs: (value) =>
                value === '' ? undefined : Number(value),
            })}
          >
            <option value="">{tDashboard('fieldPriceRangeUnset')}</option>
            <option value="1">
              $ · {tDashboard('fieldPriceRangeBudget')}
            </option>
            <option value="2">
              $$ · {tDashboard('fieldPriceRangeMidRange')}
            </option>
            <option value="3">
              $$$ · {tDashboard('fieldPriceRangePremium')}
            </option>
          </NativeSelect>
        </FormField>

        <FormField
          id="submission-mit-story"
          label={tDashboard('mitStoryLabel')}
          description={tDashboard('mitStoryHint')}
        >
          <Textarea
            id="submission-mit-story"
            rows={5}
            placeholder={tDashboard('mitStoryPlaceholder')}
            {...form.register('mitStory')}
          />
        </FormField>
      </StandardFormStack>
    </StandardFormSection>
  )
}
