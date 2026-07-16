'use client'

import { FormProvider } from 'react-hook-form'
import { BrandMediaSection } from '@/components/brand-wizard/media-section'
import { useSubmissionWizard } from '../submission-wizard-context'

export function MediaSection() {
  const { form, uploadSessionId } = useSubmissionWizard()

  return (
    <FormProvider {...form}>
      <BrandMediaSection
        uploadPath={`submissions/${uploadSessionId}/hero`}
        heroRequired
        productPhotosRequired={false}
      />
    </FormProvider>
  )
}
