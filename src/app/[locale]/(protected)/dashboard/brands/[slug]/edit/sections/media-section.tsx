'use client'

import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller } from 'react-hook-form'
import { ImageUploadField } from '@/components/forms/image-upload-field'
import { ProductPhotosField } from '@/components/forms/product-photos-field'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function MediaSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')

  return (
    <section id="media" className="space-y-4 scroll-mt-8">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionMedia')}
      </h2>

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
    </section>
  )
}
