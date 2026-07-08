'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller, useFieldArray } from 'react-hook-form'
import { DashboardFormField } from './dashboard-form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RequiredFieldsHint } from '@/components/forms/required-fields-hint'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function LinksSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')
  const tx = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback)
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'otherUrls',
  })

  return (
    <StandardFormSection id="purchase" className="scroll-mt-8">
      <StandardFormStack>
        <h2 className="type-section-title">
          {t('sectionLinks')}
        </h2>
        <RequiredFieldsHint />

        <div id="social-proof" className="space-y-4">
          <h3 className="type-subsection-title">
            {tx('socialLinksLabel', 'Social links')}
          </h3>
          <div className="grid gap-3">
            <LinkedInput
              control={form.control}
              name="socialInstagram"
              label={t('fieldInstagram')}
              placeholder="@yourbrand"
            />
            <LinkedInput
              control={form.control}
              name="socialThreads"
              label={t('fieldThreads')}
              placeholder="@yourbrand"
            />
            <LinkedInput
              control={form.control}
              name="socialFacebook"
              label={t('fieldFacebook')}
              type="url"
              placeholder="https://facebook.com/yourbrand"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="type-subsection-title">
            {t('fieldPurchaseLinks')}
          </h3>
          <div className="grid gap-3">
            <LinkedInput
              control={form.control}
              name="purchaseWebsite"
              label={t('fieldOfficialWebsite')}
              type="url"
              placeholder="https://yourbrand.com"
              required
              error={
                form.formState.errors.purchaseWebsite
                  ? t('requiredFieldError')
                  : undefined
              }
            />
            <LinkedInput
              control={form.control}
              name="purchasePinkoi"
              label="Pinkoi"
              type="url"
              placeholder="https://pinkoi.com/..."
            />
            <LinkedInput
              control={form.control}
              name="purchaseShopee"
              label={tx('fieldShopee', 'Shopee')}
              type="url"
              placeholder="https://shopee.tw/..."
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="type-subsection-title">
            {tx('fieldOtherLinks', 'Other links')}
          </h3>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_48px]"
              >
                <Input
                  className="min-h-12 bg-card"
                  aria-label={t('fieldLabelPlaceholder')}
                  placeholder={t('fieldLabelPlaceholder')}
                  {...form.register(`otherUrls.${index}.label`)}
                />
                <Input
                  className="min-h-12 bg-card"
                  type="url"
                  aria-label={t('fieldUrlPlaceholder')}
                  placeholder={t('fieldUrlPlaceholder')}
                  {...form.register(`otherUrls.${index}.url`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={t('removeItem')}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => append({ label: '', url: '' })}
            >
              <Plus className="size-3.5" />
              {tx('addLink', 'Add link')}
            </Button>
          </div>
        </div>
      </StandardFormStack>
    </StandardFormSection>
  )
}

function LinkedInput({
  control,
  name,
  label,
  type = 'text',
  placeholder,
  required = false,
  error,
}: {
  control: UseFormReturn<BrandEditFormValues>['control']
  name:
    | 'socialInstagram'
    | 'socialThreads'
    | 'socialFacebook'
    | 'purchaseWebsite'
    | 'purchasePinkoi'
    | 'purchaseShopee'
  label: string
  type?: string
  placeholder: string
  required?: boolean
  error?: string
}) {
  return (
    <DashboardFormField
      id={name}
      label={label}
      required={required}
      error={error}
      errorId={`${name}-error`}
      className="px-0 py-0"
    >
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Input
            id={name}
            aria-required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${name}-error` : undefined}
            type={type}
            placeholder={placeholder}
            className="min-h-12 bg-card"
            value={field.value ?? ''}
            onChange={(event) => {
              const value =
                name === 'socialInstagram' || name === 'socialThreads'
                  ? event.target.value.replace(/^@+/, '')
                  : event.target.value
              field.onChange(value)
            }}
          />
        )}
      />
    </DashboardFormField>
  )
}
