'use client'

import { useCallback } from 'react'
import { useFormContext, Controller } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Pencil } from 'lucide-react'
import type { SubmissionFormData } from '@/lib/validations/submission'
import type { TaxonomyTag } from '@/lib/types'
import { TurnstileWidget } from './TurnstileWidget'

type ReviewStepProps = {
  onEditStep: (stepIndex: number) => void
  regionTags?: TaxonomyTag[]
  valueTags?: TaxonomyTag[]
}

function SectionHeader({
  title,
  editLabel,
  stepIndex,
  onEdit,
}: {
  title: string
  editLabel: string
  stepIndex: number
  onEdit: (step: number) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[13px] font-semibold text-foreground/80">{title}</h3>
      <button
        type="button"
        onClick={() => onEdit(stepIndex)}
        className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary"
      >
        <Pencil className="h-3 w-3" />
        {editLabel}
      </button>
    </div>
  )
}

function ReviewRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="w-[140px] shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <span className="text-[13px] font-semibold text-foreground">
        {value || <span className="font-normal text-muted-foreground">--</span>}
      </span>
    </div>
  )
}

export function ReviewStep({
  onEditStep,
  regionTags = [],
  valueTags = [],
}: ReviewStepProps) {
  const t = useTranslations('submit.review')
  const { control, watch, setValue, register } = useFormContext<SubmissionFormData>()

  const formData = watch()

  const selectedRegion = regionTags.find((tag) => tag.slug === formData.region)
  const selectedValueTags = formData.valueTags
    ?.map((slug) => valueTags.find((tag) => tag.slug === slug))
    .filter((tag): tag is TaxonomyTag => Boolean(tag))

  const handleTurnstileSuccess = useCallback(
    (token: string) => setValue('turnstileToken', token),
    [setValue]
  )

  return (
    <div className="space-y-6">
      {/* Brand Info Panel */}
      <div className="space-y-3">
        <SectionHeader
          title={t('brandInfo')}
          editLabel={t('edit')}
          stepIndex={0}
          onEdit={onEditStep}
        />
        <div className="space-y-2 rounded-lg bg-background p-4">
          <ReviewRow label={t('brandName')} value={formData.name} />
          <ReviewRow label={t('description')} value={formData.description} />
          <ReviewRow label={t('category')} value={formData.category} />
          <ReviewRow
            label={t('region')}
            value={
              selectedRegion
                ? `${selectedRegion.nameZh} (${selectedRegion.name})`
                : null
            }
          />
          <ReviewRow
            label={t('valueTags')}
            value={
              selectedValueTags?.length
                ? selectedValueTags
                    .map((tag) => `${tag.nameZh} (${tag.name})`)
                    .join(', ')
                : null
            }
          />
          {formData.logoUrl && (
            <div className="flex gap-3">
              <span className="w-[140px] shrink-0 text-xs text-muted-foreground">
                {t('logo')}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={formData.logoUrl}
                alt={t('brandLogoAlt')}
                className="h-16 w-16 rounded-lg object-cover"
              />
            </div>
          )}
        </div>
      </div>

      {/* Links Panel */}
      <div className="space-y-3">
        <SectionHeader
          title={t('linksAndSocial')}
          editLabel={t('edit')}
          stepIndex={0}
          onEdit={onEditStep}
        />
        <div className="space-y-2 rounded-lg bg-background p-4">
          {formData.purchaseLinks?.map((link, i) => (
            <ReviewRow
              key={i}
              label={link.platform || 'Link'}
              value={
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground underline"
                >
                  {link.url}
                </a>
              }
            />
          ))}
          {formData.socialLinks?.instagram && (
            <ReviewRow
              label="Instagram"
              value={formData.socialLinks.instagram}
            />
          )}
          {formData.socialLinks?.website && (
            <ReviewRow
              label="Website"
              value={formData.socialLinks.website}
            />
          )}
        </div>
      </div>

      {/* PDPA Consent */}
      <div className="space-y-2 rounded-lg border border-border p-4">
        <Controller
          name="pdpaConsent"
          control={control}
          render={({ field, fieldState }) => (
            <div className="space-y-1">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.value}
                  onChange={field.onChange}
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-border accent-cta"
                />
                <span className="text-[13px] text-foreground">
                  {t.rich('pdpaConsent', {
                    privacyPolicy: (chunks) => (
                      <a
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground underline"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </span>
              </label>
              {fieldState.error && (
                <p className="text-xs text-red-600">
                  {fieldState.error.message}
                </p>
              )}
            </div>
          )}
        />
      </div>

      {/* Bot detection */}
      <TurnstileWidget
        onSuccess={handleTurnstileSuccess}
      />

      {/* Honeypot — hidden from real users, traps bots */}
      <input
        type="text"
        {...register('_honeypot')}
        tabIndex={-1}
        autoComplete="off"
        className="absolute -left-[9999px] opacity-0 h-0 w-0 pointer-events-none"
        aria-hidden="true"
      />
    </div>
  )
}
