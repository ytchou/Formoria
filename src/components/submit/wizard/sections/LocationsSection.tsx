'use client'

import { FormProvider } from 'react-hook-form'
import { BrandLocationsSection } from '@/components/brand-wizard/locations-section'
import { useSubmissionWizard } from '../submission-wizard-context'

export function LocationsSection() {
  const { form } = useSubmissionWizard()

  return (
    <FormProvider {...form}>
      <BrandLocationsSection />
    </FormProvider>
  )
}
