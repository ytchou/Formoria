'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Controller, useFieldArray } from 'react-hook-form'
import { FormField } from '@/components/forms/form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSubmissionWizard } from '../submission-wizard-context'

type LinkFieldName =
  | 'socialInstagram'
  | 'socialThreads'
  | 'socialFacebook'
  | 'purchaseWebsite'
  | 'purchasePinkoi'
  | 'purchaseShopee'

export function LinksSection() {
  const t = useTranslations('submit')
  const tDashboard = useTranslations('dashboard.edit')
  const { form } = useSubmissionWizard()
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'otherUrls',
  })

  return (
    <StandardFormSection id="submission-links">
      <StandardFormStack>
        <h2 className="type-section-title">
          {t('submissionWizard.linksHeading')}
        </h2>

        <div className="space-y-4">
          <h3 className="type-subsection-title">{t('fields.socialLinks')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <LinkInput
              name="socialInstagram"
              label={t('ownerForm.instagramLabel')}
              placeholder="https://instagram.com/yourbrand"
            />
            <LinkInput
              name="socialThreads"
              label={t('ownerForm.threadsLabel')}
              placeholder="https://threads.net/@yourbrand"
            />
            <LinkInput
              name="socialFacebook"
              label={t('ownerForm.facebookLabel')}
              placeholder="https://facebook.com/yourbrand"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="type-subsection-title">
            {t('fields.purchaseLinksOptional')}
          </h3>
          <p className="type-form-hint">{t('fields.purchaseLinksHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <LinkInput
              name="purchaseWebsite"
              label={tDashboard('fieldOfficialWebsite')}
              placeholder="https://yourbrand.com/shop"
            />
            <LinkInput
              name="purchasePinkoi"
              label={t('ownerForm.pinkoiLabel')}
              placeholder="https://pinkoi.com/store/yourbrand"
            />
            <LinkInput
              name="purchaseShopee"
              label={t('ownerForm.shopeeLabel')}
              placeholder="https://shopee.tw/yourbrand"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="type-subsection-title">
            {t('submissionWizard.otherUrlsLabel')}
          </h3>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_48px]"
              >
                <Input
                  aria-label={tDashboard('fieldLabelPlaceholder')}
                  placeholder={tDashboard('fieldLabelPlaceholder')}
                  {...form.register(`otherUrls.${index}.label`)}
                />
                <Input
                  type="url"
                  aria-label={tDashboard('fieldUrlPlaceholder')}
                  aria-invalid={Boolean(
                    form.formState.errors.otherUrls?.[index]?.url,
                  )}
                  placeholder={tDashboard('fieldUrlPlaceholder')}
                  {...form.register(`otherUrls.${index}.url`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-12"
                  aria-label={tDashboard('removeItem')}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => append({ label: '', url: '' })}
            >
              <Plus className="size-4" />
              {t('submissionWizard.addOtherUrl')}
            </Button>
          </div>
        </div>
      </StandardFormStack>
    </StandardFormSection>
  )
}

function LinkInput({
  name,
  label,
  placeholder,
}: {
  name: LinkFieldName
  label: string
  placeholder: string
}) {
  const t = useTranslations('submit')
  const { form } = useSubmissionWizard()
  const error = form.formState.errors[name]

  return (
    <FormField
      id={`submission-${name}`}
      label={label}
      error={error ? t('validation.urlInvalid') : undefined}
    >
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Input
            id={`submission-${name}`}
            type="url"
            autoComplete="url"
            placeholder={placeholder}
            value={field.value ?? ''}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
    </FormField>
  )
}
