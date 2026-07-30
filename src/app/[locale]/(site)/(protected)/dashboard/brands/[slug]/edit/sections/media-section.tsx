'use client'

import { FormProvider, type UseFormReturn } from 'react-hook-form'
import { BrandMediaSection } from '@/components/brand-wizard/media-section'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function MediaSection({
  form,
  brandId,
}: {
  form: UseFormReturn<BrandEditFormValues>
  brandId: string
}) {
  return (
    <FormProvider {...form}>
      <BrandMediaSection brandId={brandId} heroRequired productPhotosRequired />
    </FormProvider>
  )
}
