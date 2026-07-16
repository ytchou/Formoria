'use client'

import { useTranslations } from 'next-intl'
import { Controller } from 'react-hook-form'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { ImageUploadField } from '@/components/forms/image-upload-field'
import { ProductPhotosField } from '@/components/forms/product-photos-field'
import { useSubmissionWizard } from '../submission-wizard-context'

export function MediaSection() {
  const t = useTranslations('submit')
  const { form, uploadSessionId } = useSubmissionWizard()

  return (
    <StandardFormSection id="submission-media">
      <StandardFormStack>
        <h2 className="type-section-title">
          {t('submissionWizard.mediaHeading')}
        </h2>

        <Controller
          control={form.control}
          name="heroImageUrl"
          render={({ field }) => (
            <ImageUploadField
              name={field.name}
              label={t('fields.heroImage')}
              description={t('ownerForm.heroImageHintOwner')}
              uploadPath={`submissions/${uploadSessionId}/hero`}
              value={field.value ?? ''}
              onChange={field.onChange}
              required
              error={
                form.formState.errors.heroImageUrl
                  ? t('validation.heroImageRequired')
                  : undefined
              }
            />
          )}
        />

        <Controller
          control={form.control}
          name="productPhotos"
          render={({ field }) => (
            <ProductPhotosField
              value={field.value ?? []}
              onChange={field.onChange}
              label={t('fields.productPhotos')}
              description={t('fields.productPhotosHint')}
              error={
                form.formState.errors.productPhotos
                  ? t('validation.photosMax')
                  : undefined
              }
            />
          )}
        />
      </StandardFormStack>
    </StandardFormSection>
  )
}
