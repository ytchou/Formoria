'use client'

import { useTranslations } from 'next-intl'
import { Controller, useFormContext } from 'react-hook-form'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { ImageUploadField } from '@/components/forms/image-upload-field'
import { ProductPhotosField } from '@/components/forms/product-photos-field'
import { RequiredFieldsHint } from '@/components/forms/required-fields-hint'
import type { BrandWizardCommonValues } from '@/lib/schemas/brand-wizard'

export function BrandMediaSection({
  brandId,
  uploadPath,
  heroRequired,
  productPhotosRequired,
}: {
  brandId?: string
  uploadPath?: string
  heroRequired: boolean
  productPhotosRequired: boolean
}) {
  const form = useFormContext<BrandWizardCommonValues>()
  const t = useTranslations('dashboard.edit')

  // `brands/tmp/` is only correct for the submission flow: the brand row does not
  // exist yet, so there is no id to key the storage path on. Once a brand exists
  // its images must live under `brands/<id>/` — otherwise every edit strands the
  // uploaded file in the temp prefix forever.
  const heroPath =
    uploadPath ??
    (brandId ? `brands/${brandId}/heroImageUrl` : 'brands/tmp/heroImageUrl')
  const productPhotosPath = brandId
    ? `brands/${brandId}/productPhotos`
    : 'brands/tmp/productPhotos'

  return (
    <StandardFormSection id="media" className="scroll-mt-8">
      <StandardFormStack>
        <h2 className="type-card-title">
          {t('sectionMedia')}
        </h2>
        {heroRequired || productPhotosRequired ? <RequiredFieldsHint /> : null}

        <div aria-required={heroRequired}>
          <Controller
            control={form.control}
            name="heroImageUrl"
            render={({ field }) => (
              <ImageUploadField
                name={field.name}
                label={t('fieldHeroImage')}
                description={t('heroImageEditHint')}
                uploadPath={heroPath}
                value={field.value ?? ''}
                onChange={field.onChange}
                required={heroRequired}
                error={
                  heroRequired && form.formState.errors.heroImageUrl
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
              uploadPath={productPhotosPath}
              error={
                productPhotosRequired && form.formState.errors.productPhotos
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
