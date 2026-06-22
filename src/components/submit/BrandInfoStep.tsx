'use client'

import { useCallback, useRef, useState } from 'react'
import { useFormContext, Controller, useFieldArray } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Plus, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { checkDuplicates, suggestCleanName } from '@/app/[locale]/submit/actions'
import { Link } from '@/i18n/navigation'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import type { SubmissionFormData } from '@/lib/validations/submission'
import type { TaxonomyTag } from '@/lib/types/taxonomy'
import type { DuplicateCheckResult, SourceAttribution } from '@/lib/types/submission'
import { TurnstileWidget } from './TurnstileWidget'

type BrandInfoStepProps = {
  regionTags: TaxonomyTag[]
  isOwner?: boolean
  onOwnerChange?: (isOwner: boolean) => void
  sourceAttribution?: SourceAttribution
  onAttributionChange?: (attribution: SourceAttribution | undefined) => void
  uploadPath?: string
}

function Alert({
  variant,
  children,
}: {
  variant?: 'destructive'
  children: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className={`rounded-lg border bg-white p-4 text-sm ${
        variant === 'destructive'
          ? 'border-red-200 text-red-800'
          : 'border-border text-foreground'
      }`}
    >
      {children}
    </div>
  )
}

function AlertTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-semibold">{children}</div>
}

function AlertDescription({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-sm">{children}</div>
}

export function BrandInfoStep({
  regionTags,
  isOwner = false,
  onOwnerChange,
  sourceAttribution,
  onAttributionChange,
}: BrandInfoStepProps) {
  const t = useTranslations('submit.fields')
  const tSubmit = useTranslations('submit')
  const tReview = useTranslations('submit.review')
  const {
    register,
    control,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<SubmissionFormData>()
  const { fields: locationFields, append: appendLocation, remove: removeLocation } = useFieldArray({ control, name: 'retailLocations' })

  const name = watch('name') ?? ''
  const unifiedBusinessNumber = watch('unifiedBusinessNumber') ?? ''
  const [dedupResult, setDedupResult] = useState<DuplicateCheckResult | null>(
    null
  )
  const [dedupCheckedName, setDedupCheckedName] = useState('')
  const [dedupCheckedUbn, setDedupCheckedUbn] = useState('')
  const [dedupConfirmed, setDedupConfirmed] = useState(false)
  const [dedupError, setDedupError] = useState<string | null>(null)
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false)
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const nameBlurRequestRef = useRef(0)
  const nameRegistration = register('name')
  const activeDedupResult =
    dedupResult &&
    dedupCheckedName === name &&
    dedupCheckedUbn === unifiedBusinessNumber
      ? dedupResult
      : null

  const handleDuplicateCheck = async () => {
    setDedupError(null)
    if (activeDedupResult?.ubnMatch) return

    const formValues = getValues()
    const formUbn = formValues.unifiedBusinessNumber ?? ''
    const hasConfirmedCurrentDuplicate =
      dedupConfirmed &&
      dedupCheckedName === formValues.name &&
      dedupCheckedUbn === formUbn

    setIsCheckingDuplicates(true)
    try {
      const result = await checkDuplicates(
        formValues.name,
        formValues.unifiedBusinessNumber
      )
      setDedupCheckedName(formValues.name)
      setDedupCheckedUbn(formUbn)
      setDedupResult(result)

      if (result.ubnMatch) return
      if (result.nameMatches.length > 0 && !hasConfirmedCurrentDuplicate) {
        setDedupConfirmed(false)
        return
      }
    } catch (err) {
      console.error("[handleNext] checkDuplicates failed:", err)
      setDedupError(t("dedup_check_failed"))
    } finally {
      setIsCheckingDuplicates(false)
    }
  }

  const handleNameBlur = async () => {
    const currentName = getValues('name')
    if (!currentName || currentName.length < 2) return

    const requestId = ++nameBlurRequestRef.current
    try {
      const result = await suggestCleanName(currentName)
      if (requestId !== nameBlurRequestRef.current) return

      if (result.changed && result.suggestion) {
        setNameSuggestion(result.suggestion)
      } else {
        setNameSuggestion(null)
      }
    } catch (error) {
      if (requestId === nameBlurRequestRef.current) {
        setNameSuggestion(null)
      }
      console.error('Failed to suggest clean name:', error)
    }
  }

  const handleTurnstileSuccess = useCallback(
    (token: string) => setValue('turnstileToken', token, { shouldValidate: true }),
    [setValue]
  )

  return (
    <div className="space-y-6">
      {/* Brand Name */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-name"
          className="block text-sm font-semibold text-foreground"
        >
          {t('brandName')}
        </label>
        <input
          id="brand-name"
          type="text"
          placeholder={t('brandNamePlaceholder')}
          className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          {...nameRegistration}
          onBlur={async (event) => {
            nameRegistration.onBlur(event)
            await handleNameBlur()
          }}
          onChange={(event) => {
            setNameSuggestion(null)
            nameRegistration.onChange(event)
          }}
        />
        {nameSuggestion && (
          <Alert>
            <AlertDescription>
              <div className="flex items-center justify-between gap-3">
                <span>
                  {t('suggestedName')} <strong>{nameSuggestion}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setValue('name', nameSuggestion)
                    setNameSuggestion(null)
                  }}
                  className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary active:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  {t('applySuggestion')}
                </button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {errors.name && (
          <p className="text-xs text-red-600">{errors.name.message}</p>
        )}
      </div>

      {/* Unified Business Number */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-ubn"
          className="block text-sm font-semibold text-foreground"
        >
          {t('ubn')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('ubnHint')}
        </p>
        <Input
          id="brand-ubn"
          placeholder="12345678"
          inputMode="numeric"
          maxLength={8}
          className="h-auto rounded-lg border-border bg-white px-[14px] py-2.5"
          {...register('unifiedBusinessNumber')}
        />
        {errors.unifiedBusinessNumber && (
          <p className="text-xs text-red-600">
            {errors.unifiedBusinessNumber.message}
          </p>
        )}
      </div>

      {/* Website URL */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-website"
          className="block text-sm font-semibold text-foreground"
        >
          {tSubmit('url.label')}
        </label>
        <Controller
          name="website"
          control={control}
          render={({ field }) => (
            <Input
              id="brand-website"
              type="url"
              placeholder="https://yourbrand.com"
              value={field.value ?? ''}
              onChange={(event) => {
                const website = event.target.value
                field.onChange(website)
                setValue('socialLinks.website', website, { shouldValidate: true })
              }}
              className="h-11 rounded-lg border-border bg-white px-[14px] py-2.5"
            />
          )}
        />
        {errors.website && (
          <p className="text-xs text-red-600">{errors.website.message}</p>
        )}
      </div>

      {/* Region */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-region"
          className="block text-sm font-semibold text-foreground"
        >
          {t('region')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('regionHint')}
        </p>
        <select
          id="brand-region"
          className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          {...register('region')}
        >
          <option value="" disabled>
            {t('regionPlaceholder')}
          </option>
          {regionTags.map((tag) => (
            <option key={tag.id} value={tag.slug}>
              {tag.nameZh} ({tag.name})
            </option>
          ))}
        </select>
        {errors.region && (
          <p className="text-xs text-red-600">{errors.region.message}</p>
        )}
      </div>

      {/* Retail Locations */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('retailLocations')}</h3>
          <p className="text-xs text-muted-foreground">{t('retailLocationsHint')}</p>
        </div>
        {locationFields.length > 0 && (
          <div className="space-y-2">
            {locationFields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <input type="text" placeholder={t('storeName')} className="h-11 w-40 shrink-0 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20" {...register(`retailLocations.${index}.name`)} />
                <input type="text" placeholder={t('address')} className="h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20" {...register(`retailLocations.${index}.address`)} />
                <button type="button" onClick={() => removeLocation(index)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Remove location ${index + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={() => appendLocation({ name: '', address: '' })} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground/80">
          <Plus className="h-4 w-4" />
          {t('addLocation')}
        </button>
      </div>

      <div className="space-y-4 rounded-lg border border-border p-4">
        {!isOwner && (
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-foreground">
              {tSubmit('url.howKnowBrand')}
            </label>
            <Select
              value={sourceAttribution}
              onValueChange={(val) => onAttributionChange?.(val as SourceAttribution)}
            >
              <SelectTrigger
                aria-label={tSubmit('url.howKnowBrand')}
                className="h-12 w-full border-border text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <SelectValue placeholder={tSubmit('url.howKnowPlaceholder')}>
                  {(val) => (val ? tSubmit(`attribution.${val}`) : null)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SOURCE_ATTRIBUTION_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tSubmit(`attribution.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.sourceAttribution && (
              <p className="text-xs text-red-600">{errors.sourceAttribution.message}</p>
            )}
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id="is-brand-owner-form"
              checked={isOwner}
              onCheckedChange={(checked: boolean) => onOwnerChange?.(checked)}
            />
            <label
              htmlFor="is-brand-owner-form"
              className="cursor-pointer select-none text-sm font-medium text-foreground"
            >
              {tSubmit('url.isBrandOwner')}
            </label>
          </div>
          <p className="pl-6 text-xs font-semibold text-foreground">
            {tSubmit('url.ownerHint')}{' '}
            <Link href="/faq#claimBenefits" className="underline hover:text-foreground">
              {tSubmit('url.ownerLearnMore')}
            </Link>
          </p>
        </div>
      </div>

      {activeDedupResult?.ubnMatch && (
        <Alert variant="destructive">
          <AlertTitle>{t('ubnDuplicateTitle')}</AlertTitle>
          <AlertDescription>
            {t('ubnDuplicateSeeExisting')}
            <Link
              href={`/brands/${activeDedupResult.ubnMatch.slug}`}
              className="ml-1 underline"
            >
              {activeDedupResult.ubnMatch.name}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {activeDedupResult &&
        !activeDedupResult.ubnMatch &&
        activeDedupResult.nameMatches.length > 0 && (
          <Alert>
            <AlertTitle>{t('nameDuplicateTitle')}</AlertTitle>
            <AlertDescription>
              <ul className="mb-2 mt-1 list-inside list-disc">
                {activeDedupResult.nameMatches.map((m) => (
                  <li key={m.id}>
                    {m.name} ({Math.round(m.similarity * 100)}%)
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <Checkbox
                  id="dedup-confirm"
                  checked={dedupConfirmed}
                  onCheckedChange={(checked) => setDedupConfirmed(!!checked)}
                  className="data-[checked]:border-[#2F5D50] data-[checked]:bg-[#2F5D50] focus-visible:ring-[#2F5D50]/40"
                />
                <label
                  htmlFor="dedup-confirm"
                  className="cursor-pointer text-sm"
                >
                  {t('nameDuplicateConfirmLabel')}
                </label>
              </div>
            </AlertDescription>
          </Alert>
        )}

      {(name.length >= 2 || unifiedBusinessNumber) && (
        <div className="flex flex-col items-start">
          <button
            type="button"
            onClick={handleDuplicateCheck}
            disabled={isCheckingDuplicates || !!activeDedupResult?.ubnMatch}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {isCheckingDuplicates ? t('checking') : t('next')}
          </button>
          {dedupError && (
            <p className="text-sm text-destructive mt-1">{dedupError}</p>
          )}
        </div>
      )}

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
                  {tReview.rich('pdpaConsent', {
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
                <p className="text-xs text-red-600">
                  {fieldState.error.message}
                </p>
              )}
            </div>
          )}
        />
      </div>

      <input type="hidden" {...register('turnstileToken')} />
      <TurnstileWidget onSuccess={handleTurnstileSuccess} />

      <input
        type="text"
        {...register('_honeypot')}
        tabIndex={-1}
        autoComplete="off"
        className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />
    </div>
  )
}
