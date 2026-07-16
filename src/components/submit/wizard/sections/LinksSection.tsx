'use client'

import { FormProvider } from 'react-hook-form'
import { BrandLinksSection } from '@/components/brand-wizard/links-section'
import { useSubmissionWizard } from '../submission-wizard-context'

export function LinksSection() {
  const { form } = useSubmissionWizard()

  return (
    <FormProvider {...form}>
      <BrandLinksSection officialWebsiteRequired={false} />
    </FormProvider>
  )
}
