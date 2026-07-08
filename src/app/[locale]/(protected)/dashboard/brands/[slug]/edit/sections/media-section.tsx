'use client'

import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller } from 'react-hook-form'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { ImageUploadField } from '@/components/forms/image-upload-field'
import { ProductPhotosField } from '@/components/forms/product-photos-field'
import { RequiredFieldsHint } from '@/components/forms/required-fields-hint'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function MediaSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')

  return (
    <StandardFormSection id="media" className="scroll-mt-8">
      <StandardFormStack>
        <h2 className="font-heading text-base font-bold">
          {t('sectionMedia')}
        </h2>
        <RequiredFieldsHint />

        <div aria-required="true">
          <Controller
            control={form.control}
            name="heroImageUrl"
            render={({ field }) => (
              <ImageUploadField
                name={field.name}
                label={t('fieldHeroImage')}
                description={t('heroImageEditHint')}
                uploadPath="brands/tmp/heroImageUrl"
                value={field.value ?? ''}
                onChange={field.onChange}
                required
                error={
                  form.formState.errors.heroImageUrl
                    ? t('requiredFieldError')
                    : undefined
                }
              />
            )}
          />
        </div>

        <Controller
          control={form.control}
          name="productPhotos"
          render={({ field }) => (
            <ProductPhotosField
              value={field.value ?? []}
              onChange={field.onChange}
              label={t('fieldProductPhotos')}
              description={t('productPhotosEditHint')}
              error={
                form.formState.errors.productPhotos
                  ? t('requiredFieldError')
                  : undefined
              }
            />
          )}
        />
      </StandardFormStack>
    </StandardFormSection>
  )
}
