'use client'

import { FormProvider, type UseFormReturn } from 'react-hook-form'
import { BrandMediaSection } from '@/components/brand-wizard/media-section'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function MediaSection({ form }: { form: UseFormReturn<BrandEditFormValues> }) {
  return (
    <FormProvider {...form}>
      <BrandMediaSection
        uploadPath="brands/tmp/heroImageUrl"
        heroRequired
        productPhotosRequired
      />
    </FormProvider>
  )
}
