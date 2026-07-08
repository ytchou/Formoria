'use client'

import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller } from 'react-hook-form'
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
    <section id="media" className="space-y-4 scroll-mt-8">
      <h2 className="mb-4 border-b border-border px-4 pb-2 font-heading text-base font-bold">
        {t('sectionMedia')}
      </h2>
      <RequiredFieldsHint />

      <div className="space-y-4 px-4">
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
                error={form.formState.errors.heroImageUrl
                  ? t('requiredFieldError')
                  : undefined}
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
      </div>
    </section>
  )
}
