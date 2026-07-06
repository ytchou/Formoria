'use client'

import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredLabel } from '@/components/forms/required-label'
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
    <section id="purchase" className="space-y-4 scroll-mt-8">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionLinks')}
      </h2>

      <div
        id="social-proof"
        className="space-y-4 rounded-lg border border-border bg-card p-4"
      >
        <div className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 text-[11px] font-medium uppercase tracking-wide text-primary-foreground">
          {tx('socialLinksLabel', 'Social links')}
        </div>
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

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 text-[11px] font-medium uppercase tracking-wide text-primary-foreground">
          {t('fieldPurchaseLinks')}
        </div>
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

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-foreground">
          {tx('fieldOtherLinks', 'Other links')}
        </div>
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid gap-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_48px]"
            >
              <Input
                className="min-h-12 bg-card"
                placeholder={t('fieldLabelPlaceholder')}
                {...form.register(`otherUrls.${index}.label`)}
              />
              <Input
                className="min-h-12 bg-card"
                type="url"
                placeholder={t('fieldUrlPlaceholder')}
                {...form.register(`otherUrls.${index}.url`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('removeItem')}
                className="h-12 w-12"
                onClick={() => remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="min-h-12"
            onClick={() => append({ label: '', url: '' })}
          >
            {tx('addLink', 'Add link')}
          </Button>
        </div>
      </div>
    </section>
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
    <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
      {required ? (
        <RequiredLabel htmlFor={name}>{label}</RequiredLabel>
      ) : (
        <Label htmlFor={name} className="text-sm font-semibold text-foreground">
          {label}
        </Label>
      )}
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
      {error ? (
        <p
          id={`${name}-error`}
          className="text-xs text-destructive sm:col-start-2"
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
