'use client'

import { useCallback } from 'react'
import { useFormContext, Controller } from 'react-hook-form'
import { Pencil } from 'lucide-react'
import type { SubmissionFormData } from '@/lib/validations/submission'
import { TurnstileWidget } from './TurnstileWidget'

type ReviewStepProps = {
  onEditStep: (stepIndex: number) => void
}

function SectionHeader({
  title,
  stepIndex,
  onEdit,
}: {
  title: string
  stepIndex: number
  onEdit: (step: number) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[13px] font-semibold text-[#6A573F]">{title}</h3>
      <button
        type="button"
        onClick={() => onEdit(stepIndex)}
        className="inline-flex items-center gap-1 rounded-full bg-[#F5F4F1] px-3 py-1 text-xs font-medium text-[#8B7355] hover:bg-[#EAE7E1]"
      >
        <Pencil className="h-3 w-3" />
        Edit
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
      <span className="w-[140px] shrink-0 text-xs text-[#7C7570]">
        {label}
      </span>
      <span className="text-[13px] font-semibold text-[#1A1918]">
        {value || <span className="font-normal text-[#B0AAA4]">--</span>}
      </span>
    </div>
  )
}

export function ReviewStep({ onEditStep }: ReviewStepProps) {
  const { control, watch, setValue, register } = useFormContext<SubmissionFormData>()

  const formData = watch()

  const photoCount = formData.productPhotos?.length ?? 0

  const handleTurnstileSuccess = useCallback(
    (token: string) => setValue('turnstileToken', token),
    [setValue]
  )

  return (
    <div className="space-y-6">
      {/* Brand Info Panel */}
      <div className="space-y-3">
        <SectionHeader
          title="Brand Info"
          stepIndex={0}
          onEdit={onEditStep}
        />
        <div className="space-y-2 rounded-lg bg-[#FAFAF8] p-4">
          <ReviewRow label="Brand Name" value={formData.name} />
          <ReviewRow label="Description" value={formData.description} />
          <ReviewRow label="Category" value={formData.category} />
          <ReviewRow
            label="Tags"
            value={
              formData.tags?.length
                ? formData.tags.join(', ')
                : null
            }
          />
          {formData.logoUrl && (
            <div className="flex gap-3">
              <span className="w-[140px] shrink-0 text-xs text-[#7C7570]">
                Logo
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={formData.logoUrl}
                alt="Brand logo"
                className="h-16 w-16 rounded-lg object-cover"
              />
            </div>
          )}
          {formData.founderName && (
            <ReviewRow label="Founder" value={formData.founderName} />
          )}
        </div>
      </div>

      {/* Product Photos Panel */}
      <div className="space-y-3">
        <SectionHeader
          title="Product Photos"
          stepIndex={1}
          onEdit={onEditStep}
        />
        <div className="space-y-2 rounded-lg bg-[#FAFAF8] p-4">
          <p className="text-[13px] text-[#1A1918]">
            {photoCount} {photoCount === 1 ? 'photo' : 'photos'} uploaded
          </p>
          {photoCount > 0 && (
            <div className="flex flex-wrap gap-2">
              {formData.productPhotos?.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt={`Product ${i + 1}`}
                  className="h-16 w-16 rounded-lg object-cover"
                />
              ))}
            </div>
          )}
          {formData.brandHighlights && (
            <ReviewRow
              label="Highlights"
              value={formData.brandHighlights}
            />
          )}
        </div>
      </div>

      {/* Links Panel */}
      <div className="space-y-3">
        <SectionHeader
          title="Links & Social"
          stepIndex={2}
          onEdit={onEditStep}
        />
        <div className="space-y-2 rounded-lg bg-[#FAFAF8] p-4">
          {formData.purchaseLinks?.map((link, i) => (
            <ReviewRow
              key={i}
              label={link.platform || 'Link'}
              value={
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8B7355] underline"
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
      <div className="space-y-2 rounded-lg border border-[#D4CFC9] p-4">
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
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-[#D4CFC9] accent-[#E06B3F]"
                />
                <span className="text-[13px] text-[#1A1918]">
                  I agree to the collection and use of my personal data in
                  accordance with the{' '}
                  <a
                    href="/privacy"
                    target="_blank"
                    className="text-[#8B7355] underline"
                  >
                    Privacy Policy
                  </a>{' '}
                  (PDPA compliance).
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
