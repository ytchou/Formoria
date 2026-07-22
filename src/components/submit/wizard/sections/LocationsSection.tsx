'use client'

import { useEffect } from 'react'
import { FormProvider, useWatch } from 'react-hook-form'
import { BrandLocationsSection } from '@/components/brand-wizard/locations-section'
import { useSubmissionWizard } from '../submission-wizard-context'

export function LocationsSection() {
  const { form } = useSubmissionWizard()
  const retailLocations = useWatch({
    control: form.control,
    name: 'retailLocations',
  })

  useEffect(() => {
    if (!retailLocations?.some((location) =>
      location.confirmationStatus === 'owner_confirmed',
    )) return

    form.setValue(
      'retailLocations',
      retailLocations.map((location) => {
        if (location.kind === 'retail_chain') {
          return {
            kind: 'retail_chain',
            name: location.name ?? '',
            retailerUrl: location.retailerUrl ?? '',
            availabilityNote: location.availabilityNote ?? '',
          }
        }
        return {
          ...location,
          confirmationStatus: 'unconfirmed' as const,
        }
      }),
      { shouldDirty: true },
    )
  }, [form, retailLocations])

  return (
    <FormProvider {...form}>
      <BrandLocationsSection
        isActualOwner={false}
        preserveOwnerConfirmation={false}
      />
    </FormProvider>
  )
}
