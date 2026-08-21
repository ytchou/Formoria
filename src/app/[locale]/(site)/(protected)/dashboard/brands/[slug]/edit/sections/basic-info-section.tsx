'use client'

import { FormProvider, type UseFormReturn } from 'react-hook-form'
import { suggestCleanName } from '@/app/[locale]/(site)/submit/actions'
import { BrandBasicInfoSection } from '@/components/brand-wizard/basic-info-section'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function BasicInfoSection({
  form,
  subcategorySuggestions = [],
  currentSlug,
}: {
  form: UseFormReturn<BrandEditFormValues>
  subcategorySuggestions?: string[]
  currentSlug?: string
}) {
  return (
    <FormProvider {...form}>
      <BrandBasicInfoSection
        subcategorySuggestions={subcategorySuggestions}
        requiredFields={{
          name: true,
          categorySlug: true,
          description: true,
          subcategories: true,
          priceRange: true,
        }}
        suggestName={suggestCleanName}
        currentSlug={currentSlug}
      />
    </FormProvider>
  )
}
