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
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <button
        type="button"
        onClick={() => onEdit(stepIndex)}
        className="inline-flex min-h-12 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <span className="w-[140px] shrink-0 text-xs font-semibold text-foreground">
        {label}
      </span>
      <span className="text-[13px] font-semibold text-foreground">
        {value || <span className="font-normal text-foreground">--</span>}
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
  const tx = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback)
  const { control, watch, setValue, register } = useFormContext<SubmissionFormData>()

  const formData = watch()
  const flatLinks = formData as SubmissionFormData & {
    socialInstagram?: string
    socialThreads?: string
    socialFacebook?: string
    purchaseWebsite?: string
    purchasePinkoi?: string
    purchaseShopee?: string
    otherUrls?: Array<{ label: string; url: string }>
  }
  const socialInstagram = flatLinks.socialInstagram || formData.socialLinks?.instagram || ''
  const socialThreads = flatLinks.socialThreads || formData.socialLinks?.threads || ''
  const socialFacebook = flatLinks.socialFacebook || formData.socialLinks?.facebook || ''
  const purchaseWebsite = flatLinks.purchaseWebsite || formData.socialLinks?.website || ''
  const purchasePinkoi =
    flatLinks.purchasePinkoi ||
    formData.purchaseLinks?.find((link) => link.platform.toLowerCase() === 'pinkoi')?.url ||
    ''
  const purchaseShopee =
    flatLinks.purchaseShopee ||
    formData.purchaseLinks?.find((link) => link.platform.toLowerCase() === 'shopee')?.url ||
    ''
  const otherUrls = flatLinks.otherUrls ?? []

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
          {formData.heroImageUrl && (
            <div className="flex gap-3">
              <span className="w-[140px] shrink-0 text-xs font-semibold text-foreground">
                {t('logo')}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={formData.heroImageUrl}
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
          <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {tx('socialLinks', 'Social links')}
          </div>
          <ReviewRow label="Instagram" value={socialInstagram} />
          <ReviewRow label="Threads" value={socialThreads} />
          <ReviewRow
            label="Facebook"
            value={
              socialFacebook ? (
                <a
                  href={socialFacebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {socialFacebook}
                </a>
              ) : null
            }
          />

          <div className="pt-3 text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {tx('purchaseLinks', 'Purchase links')}
          </div>
          <ReviewRow
            label={tx('purchaseWebsite', 'Official Website')}
            value={
              purchaseWebsite ? (
                <a
                  href={purchaseWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {purchaseWebsite}
                </a>
              ) : null
            }
          />
          <ReviewRow
            label="Pinkoi"
            value={
              purchasePinkoi ? (
                <a
                  href={purchasePinkoi}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {purchasePinkoi}
                </a>
              ) : null
            }
          />
          <ReviewRow
            label={tx('purchaseShopee', 'Shopee')}
            value={
              purchaseShopee ? (
                <a
                  href={purchaseShopee}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {purchaseShopee}
                </a>
              ) : null
            }
          />
          {otherUrls.map((link, i) => (
            <ReviewRow
              key={`${link.label}-${i}`}
              label={link.label || tx('otherLink', 'Other link')}
              value={
                link.url ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {link.url}
                  </a>
                ) : null
              }
            />
          ))}
        </div>
      </div>

      {/* PDPA Consent */}
      <div className="space-y-2 rounded-lg border border-border p-4">
        <Controller
          name="pdpaConsent"
          control={control}
          render={({ field, fieldState }) => (
            <div className="space-y-1">
              <label className="flex min-h-12 cursor-pointer items-start gap-3">
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
                        className="text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </span>
              </label>
              {fieldState.error && (
                <p className="text-xs font-semibold text-foreground">
                  {fieldState.error.message}
                </p>
              )}
            </div>
          )}
        />
      </div>

      {/* Bot detection */}
      <input type="hidden" {...register('turnstileToken')} />
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
