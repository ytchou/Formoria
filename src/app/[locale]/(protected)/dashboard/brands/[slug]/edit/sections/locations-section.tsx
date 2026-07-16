'use client'

import { FormProvider, type UseFormReturn } from 'react-hook-form'
import { BrandLocationsSection } from '@/components/brand-wizard/locations-section'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function LocationsSection({ form }: { form: UseFormReturn<BrandEditFormValues> }) {
  return (
    <FormProvider {...form}>
      <BrandLocationsSection />
    </FormProvider>
  )
}
