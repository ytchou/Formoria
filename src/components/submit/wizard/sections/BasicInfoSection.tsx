'use client'

import { useTranslations } from 'next-intl'
import { FormProvider } from 'react-hook-form'
import { suggestCleanName } from '@/app/[locale]/submit/actions'
import { BrandBasicInfoSection } from '@/components/brand-wizard/basic-info-section'
import { FormField } from '@/components/forms/form-field'
import { Input } from '@/components/ui/input'
import { useSubmissionWizard } from '../submission-wizard-context'

export function BasicInfoSection() {
  const { form, productTagSuggestions } = useSubmissionWizard()

  return (
    <FormProvider {...form}>
      <BrandBasicInfoSection
        productTagSuggestions={productTagSuggestions}
        requiredFields={{ name: true, description: true }}
        suggestName={suggestCleanName}
        afterRomanizedName={<SourceWebsiteField />}
      />
    </FormProvider>
  )
}

function SourceWebsiteField() {
  const t = useTranslations('submit')
  const { form } = useSubmissionWizard()

  return (
    <FormField
      id="submission-website"
      label={t('ownerForm.websiteLabel')}
      description={t('ownerForm.websiteHint')}
      error={form.formState.errors.website ? t('validation.urlInvalid') : undefined}
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
  )
}
