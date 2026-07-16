'use client'

import { FormProvider, type UseFormReturn } from 'react-hook-form'
import { BrandLinksSection } from '@/components/brand-wizard/links-section'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function LinksSection({ form }: { form: UseFormReturn<BrandEditFormValues> }) {
  return (
    <FormProvider {...form}>
      <BrandLinksSection officialWebsiteRequired />
    </FormProvider>
  )
}
