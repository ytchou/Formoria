'use client'

import { FormProvider, type UseFormReturn } from 'react-hook-form'
import { BrandLocationsSection } from '@/components/brand-wizard/locations-section'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

type LocationsSectionProps = {
  form: UseFormReturn<BrandEditFormValues>
  isActualOwner?: boolean
}

export function LocationsSection({
  form,
  isActualOwner = false,
}: LocationsSectionProps) {
  return (
    <FormProvider {...form}>
      <BrandLocationsSection isActualOwner={isActualOwner} />
    </FormProvider>
  )
}
