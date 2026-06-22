'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { ChevronDown } from 'lucide-react'
import { useRouter } from '@/i18n/navigation'
import { getFullSubmissionSchema, type SubmissionFormData } from '@/lib/validations/submission'
import { submitBrand, suggestCleanName } from '@/app/[locale]/submit/actions'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import type { TaxonomyTag } from '@/lib/types/taxonomy'
import type { SourceAttribution } from '@/lib/types/submission'
import { TurnstileWidget } from '@/components/submit/TurnstileWidget'
import {
  trackSubmissionFormOpened,
  trackSubmissionCompleted,
} from '@/lib/analytics'

type SubmitFormProps = {
  regionTags?: TaxonomyTag[]
  source?: 'header_cta' | 'hero_cta' | 'footer_link'
}

export default function SubmitForm({
  regionTags = [],
  source = 'hero_cta',
}: SubmitFormProps) {
  const t = useTranslations('submit')
  const tForm = useTranslations('submit.form')
  const tReview = useTranslations('submit.review')
  const router = useRouter()

  const tSchema = useMemo(
    () => (key: string) => t(key as Parameters<typeof t>[0]),
    [t]
  )
  const fullSchema = useMemo(() => getFullSubmissionSchema(tSchema), [tSchema])

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isValid },
  } = useForm<SubmissionFormData>({
    resolver: zodResolver(fullSchema) as Resolver<SubmissionFormData>,
    defaultValues: {
      name: '',
      website: '',
      region: '',
      isOwner: true,
      sourceAttribution: undefined,
      pdpaConsent: false,
      turnstileToken: '',
      honeypot: '',
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      purchaseLinks: [],
    },
    mode: 'onTouched',
  })

  const isOwner = useWatch({ control, name: 'isOwner' })
  const pdpaConsent = useWatch({ control, name: 'pdpaConsent' })

  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const [linksOpen, setLinksOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const nameBlurRequestRef = useRef(0)
  const mountTimeRef = useRef<number | null>(null)

  useEffect(() => {
    mountTimeRef.current = Date.now()
    trackSubmissionFormOpened(source)
  // source is stable (passed as prop, no reactivity needed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    } catch {
      if (requestId === nameBlurRequestRef.current) {
        setNameSuggestion(null)
      }
    }
  }

  const handleTurnstileSuccess = useCallback(
    (token: string) => setValue('turnstileToken', token, { shouldValidate: true }),
    [setValue]
  )

  const nameRegistration = register('name')

  // eslint-disable-next-line react-hooks/refs
  const onSubmit = handleSubmit((data) => {
    setSubmitError(null)
    startTransition(async () => {
      const result = await submitBrand(data)
      if (result?.error) {
        setSubmitError(result.error)
      } else {
        router.push('/submit/confirmation')
        const mountTime = mountTimeRef.current
        if (mountTime !== null) {
          const elapsed = Math.round((Date.now() - mountTime) / 1000)
          trackSubmissionCompleted(data.name, '', false, elapsed)
        }
      }
    })
  })

  const isSubmitDisabled = !isValid || !pdpaConsent || isPending

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="font-heading text-[26px] font-bold text-foreground">
          {tForm('heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tForm('subheading')}
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-border bg-white p-8 shadow-sm"
        noValidate
      >
        <div className="flex flex-col gap-5">
          {/* Website URL */}
          <div className="space-y-1.5">
            <label
              htmlFor="submit-website"
              className="block text-sm font-semibold text-foreground"
            >
              {tForm('websiteLabel')}
            </label>
            <input
              id="submit-website"
              type="url"
              placeholder={tForm('websitePlaceholder')}
              className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#2F5D50] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]/20"
              {...register('website')}
            />
            {errors.website && (
              <p className="text-xs text-red-600">{errors.website.message}</p>
            )}
          </div>

          {/* Brand Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="submit-name"
              className="block text-sm font-semibold text-foreground"
            >
              {tForm('brandNameLabel')}
            </label>
            <input
              id="submit-name"
              type="text"
              placeholder={tForm('brandNamePlaceholder')}
              className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#2F5D50] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]/20"
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
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white p-3 text-sm">
                <span>
                  {tForm('suggestedName')} <strong>{nameSuggestion}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setValue('name', nameSuggestion)
                    setNameSuggestion(null)
                  }}
                  className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  {tForm('applySuggestion')}
                </button>
              </div>
            )}
            {errors.name && (
              <p className="text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          {/* Region */}
          <div className="space-y-1.5">
            <label
              htmlFor="submit-region"
              className="block text-sm font-semibold text-foreground"
            >
              {tForm('regionLabel')}
            </label>
            <select
              id="submit-region"
              className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-[#2F5D50] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]/20"
              {...register('region')}
            >
              <option value="" disabled>
                {tForm('regionPlaceholder')}
              </option>
              {regionTags.map((tag) => (
                <option key={tag.id} value={tag.slug}>
                  {tag.nameZh ? `${tag.nameZh} (${tag.name})` : tag.name}
                </option>
              ))}
            </select>
            {errors.region && (
              <p className="text-xs text-red-600">{errors.region.message}</p>
            )}
          </div>

          {/* Ownership card */}
          <div className="space-y-3 rounded-lg border border-border bg-[#F5F4F1] p-4">
            <Controller
              name="isOwner"
              control={control}
              render={({ field }) => (
                <div className="flex min-h-[48px] items-start gap-3">
                  <input
                    id="submit-is-owner"
                    type="checkbox"
                    checked={field.value ?? true}
                    onChange={(e) => {
                      field.onChange(e.target.checked)
                    }}
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-border accent-[#2F5D50]"
                  />
                  <div>
                    <label
                      htmlFor="submit-is-owner"
                      className="cursor-pointer text-sm font-semibold text-foreground"
                    >
                      {tForm('isOwnerLabel')}
                    </label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {tForm('isOwnerHint')}
                    </p>
                  </div>
                </div>
              )}
            />
          </div>

          {/* Conditional source attribution */}
          {!isOwner && (
            <div className="space-y-1.5">
              <label
                htmlFor="submit-source"
                className="block text-sm font-semibold text-foreground"
              >
                {tForm('sourceLabel')}
              </label>
              <Controller
                name="sourceAttribution"
                control={control}
                render={({ field }) => (
                  <select
                    id="submit-source"
                    className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-[#2F5D50] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]/20"
                    value={field.value ?? ''}
                    onChange={(e) => {
                      field.onChange((e.target.value as SourceAttribution) || undefined)
                    }}
                  >
                    <option value="" disabled>
                      {tForm('sourcePlaceholder')}
                    </option>
                    {SOURCE_ATTRIBUTION_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {t(`attribution.${value}` as Parameters<typeof t>[0])}
                      </option>
                    ))}
                  </select>
                )}
              />
              {errors.sourceAttribution && (
                <p className="text-xs text-red-600">{errors.sourceAttribution.message}</p>
              )}
            </div>
          )}

          {/* Links accordion */}
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setLinksOpen((prev) => !prev)}
              aria-expanded={linksOpen}
              className="flex min-h-[48px] w-full items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]/20"
            >
              <span>{tForm('linksAccordionLabel')}</span>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${linksOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {linksOpen && (
              <div className="space-y-4 border-t border-border px-4 pb-4 pt-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="submit-instagram"
                    className="block text-sm font-semibold text-foreground"
                  >
                    {tForm('instagramLabel')}
                  </label>
                  <input
                    id="submit-instagram"
                    type="url"
                    placeholder="https://instagram.com/yourbrand"
                    className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#2F5D50] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]/20"
                    {...register('socialLinks.instagram')}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="submit-threads"
                    className="block text-sm font-semibold text-foreground"
                  >
                    {tForm('threadsLabel')}
                  </label>
                  <input
                    id="submit-threads"
                    type="url"
                    placeholder="https://threads.net/@yourbrand"
                    className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#2F5D50] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]/20"
                    {...register('socialLinks.threads')}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="submit-facebook"
                    className="block text-sm font-semibold text-foreground"
                  >
                    {tForm('facebookLabel')}
                  </label>
                  <input
                    id="submit-facebook"
                    type="url"
                    placeholder="https://facebook.com/yourbrand"
                    className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#2F5D50] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]/20"
                    {...register('socialLinks.facebook')}
                  />
                </div>
              </div>
            )}
          </div>

          {/* PDPA consent */}
          <div className="space-y-2 rounded-lg border border-border p-4">
            <Controller
              name="pdpaConsent"
              control={control}
              render={({ field, fieldState }) => (
                <div className="space-y-1">
                  <label className="flex min-h-12 cursor-pointer items-start gap-3">
                    <input
                      id="submit-pdpa"
                      type="checkbox"
                      checked={field.value}
                      onChange={field.onChange}
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-border accent-[#2F5D50]"
                    />
                    <span className="text-[13px] text-foreground">
                      {tReview.rich('pdpaConsent', {
                        privacyPolicy: (chunks) => (
                          <a
                            href="/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50]"
                          >
                            {chunks}
                          </a>
                        ),
                      })}
                    </span>
                  </label>
                  {fieldState.error && (
                    <p className="text-xs text-red-600">{fieldState.error.message}</p>
                  )}
                </div>
              )}
            />
          </div>

          {/* Hidden honeypot */}
          <input
            type="text"
            {...register('honeypot')}
            tabIndex={-1}
            autoComplete="off"
            className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
            aria-hidden="true"
          />

          {/* Turnstile (hidden — fires onSuccess to set token) */}
          <div className="sr-only" aria-hidden="true">
            <TurnstileWidget onSuccess={handleTurnstileSuccess} />
          </div>

          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
            </p>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="flex h-12 w-full items-center justify-center rounded-lg bg-[#C4693B] px-6 text-sm font-semibold text-white hover:bg-[#C4693B]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? tForm('submittingButton') : tForm('submitButton')}
          </button>
        </div>
      </form>
    </div>
  )
}
