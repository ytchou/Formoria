'use client'

import { FormProvider, type UseFormReturn } from 'react-hook-form'
import { suggestCleanName } from '@/app/[locale]/submit/actions'
import { BrandBasicInfoSection } from '@/components/brand-wizard/basic-info-section'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function BasicInfoSection({
  form,
  productTagSuggestions = [],
}: {
  form: UseFormReturn<BrandEditFormValues>
  productTagSuggestions?: string[]
}) {
  return (
    <FormProvider {...form}>
      <BrandBasicInfoSection
        productTagSuggestions={productTagSuggestions}
        requiredFields={{
          name: true,
          productType: true,
          description: true,
          productTags: true,
          priceRange: true,
        }}
        suggestName={suggestCleanName}
      />
    </FormProvider>
  )
}
