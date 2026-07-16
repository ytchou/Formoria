'use client'

import { useEffect, type ComponentType, type ReactNode } from 'react'
import {
  AtSign,
  Camera,
  Globe2,
  Link2,
  Plus,
  Share2,
  ShoppingBag,
  Store,
  Trash2,
  UsersRound,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import { RequiredFieldsHint } from '@/components/forms/required-fields-hint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BrandWizardCommonValues } from '@/lib/schemas/brand-wizard'
import { cn } from '@/lib/utils'

type FixedLinkName =
  | 'socialInstagram'
  | 'socialThreads'
  | 'socialFacebook'
  | 'purchaseWebsite'
  | 'purchasePinkoi'
  | 'purchaseShopee'

type PlatformRow = {
  name: FixedLinkName
  label: string
  placeholder: string
  icon: ComponentType<{ className?: string }>
  iconClassName: string
  inputType?: 'text' | 'url'
}

export function BrandLinksSection({
  officialWebsiteRequired,
}: {
  officialWebsiteRequired: boolean
}) {
  const t = useTranslations('dashboard.edit')
  const form = useFormContext<BrandWizardCommonValues>()
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'otherUrls',
  })

  useEffect(() => {
    if (fields.length === 0) append({ label: '', url: '' })
  }, [append, fields.length])

  const socialRows: PlatformRow[] = [
    {
      name: 'socialInstagram',
      label: t('fieldInstagram'),
      placeholder: 'https://instagram.com/yourbrand',
      icon: Camera,
      iconClassName: 'bg-primary/10 text-primary',
    },
    {
      name: 'socialThreads',
      label: t('fieldThreads'),
      placeholder: 'https://threads.net/@yourbrand',
      icon: AtSign,
      iconClassName: 'bg-foreground/10 text-foreground',
    },
    {
      name: 'socialFacebook',
      label: t('fieldFacebook'),
      placeholder: 'https://facebook.com/yourbrand',
      icon: Share2,
      iconClassName: 'bg-primary-light/20 text-primary-dark',
      inputType: 'url',
    },
  ]
  const purchaseRows: PlatformRow[] = [
    {
      name: 'purchaseWebsite',
      label: t('fieldOfficialWebsite'),
      placeholder: 'https://yourbrand.com',
      icon: Globe2,
      iconClassName: 'bg-foreground/10 text-foreground',
      inputType: 'url',
    },
    {
      name: 'purchasePinkoi',
      label: 'Pinkoi',
      placeholder: 'https://pinkoi.com/store/yourbrand',
      icon: Store,
      iconClassName: 'bg-primary/10 text-primary',
      inputType: 'url',
    },
    {
      name: 'purchaseShopee',
      label: t('fieldShopee'),
      placeholder: 'https://shopee.tw/yourbrand',
      icon: ShoppingBag,
      iconClassName: 'bg-destructive/10 text-destructive',
      inputType: 'url',
    },
  ]

  return (
    <section id="purchase" className="scroll-mt-8 space-y-5">
      <div className="space-y-1">
        <h2 className="type-section-title">{t('sectionLinks')}</h2>
        {officialWebsiteRequired ? <RequiredFieldsHint /> : null}
      </div>

      <LinkGroup
        label={t('socialLinksLabel')}
        icon={UsersRound}
        iconClassName="bg-primary/10 text-primary"
      >
        {socialRows.map((row) => (
          <FixedPlatformRow key={row.name} row={row} required={false} />
        ))}
      </LinkGroup>

      <LinkGroup
        label={t('fieldPurchaseLinks')}
        icon={ShoppingBag}
        iconClassName="bg-verified-green-bg text-verified-green"
      >
        {purchaseRows.map((row) => (
          <FixedPlatformRow
            key={row.name}
            row={row}
            required={row.name === 'purchaseWebsite' && officialWebsiteRequired}
          />
        ))}
      </LinkGroup>

      <LinkGroup
        label={t('fieldOtherLinks')}
        icon={Link2}
        iconClassName="bg-secondary text-primary"
      >
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_3rem] gap-2">
            <span className="type-caption">{t('fieldLabelPlaceholder')}</span>
            <span className="type-caption">{t('fieldUrlPlaceholder')}</span>
            <span />
          </div>
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_3rem] items-start gap-2"
            >
              <Input
                className="min-h-12 bg-card"
                aria-label={t('fieldLabelPlaceholder')}
                placeholder={t('fieldLabelPlaceholder')}
                aria-invalid={Boolean(form.formState.errors.otherUrls?.[index]?.label)}
                {...form.register(`otherUrls.${index}.label`)}
              />
              <Input
                className="min-h-12 bg-card"
                type="url"
                aria-label={t('fieldUrlPlaceholder')}
                placeholder={t('fieldUrlPlaceholder')}
                aria-invalid={Boolean(form.formState.errors.otherUrls?.[index]?.url)}
                {...form.register(`otherUrls.${index}.url`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-12"
                aria-label={t('removeItem')}
                onClick={() => remove(index)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            className="min-h-12"
            onClick={() => append({ label: '', url: '' })}
          >
            <Plus className="size-4" />
            {t('addLink')}
          </Button>
        </div>
      </LinkGroup>
    </section>
  )
}

function LinkGroup({
  label,
  icon: Icon,
  iconClassName,
  children,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  iconClassName: string
  children: ReactNode
}) {
  return (
    <fieldset className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <legend className="sr-only">{label}</legend>
      <div className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            iconClassName,
          )}
        >
          <Icon className="size-4" />
        </span>
        <h3 className="type-subsection-title">{label}</h3>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </fieldset>
  )
}

function FixedPlatformRow({ row, required }: { row: PlatformRow; required: boolean }) {
  const form = useFormContext<BrandWizardCommonValues>()
  const Icon = row.icon
  const error = form.formState.errors[row.name]

  return (
    <div
      data-platform-row
      className="grid min-h-16 grid-cols-[2rem_6.25rem_minmax(0,1fr)] items-center gap-3 px-4 py-2"
    >
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-lg',
          row.iconClassName,
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <Label htmlFor={row.name} className="type-label">
        {row.label}
        {required ? <span aria-hidden="true" className="text-destructive"> *</span> : null}
      </Label>
      <Controller
        control={form.control}
        name={row.name}
        render={({ field }) => (
          <Input
            id={row.name}
            type={row.inputType ?? 'text'}
            inputMode="url"
            autoComplete="url"
            aria-label={row.label}
            aria-required={required}
            aria-invalid={Boolean(error)}
            placeholder={row.placeholder}
            className="min-h-12 bg-card"
            value={field.value ?? ''}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
    </div>
  )
}
