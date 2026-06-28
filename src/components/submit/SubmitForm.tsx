'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'

import { useRouter } from '@/i18n/navigation'
import { getFullSubmissionSchema, type SubmissionFormData } from '@/lib/validations/submission'
import { submitBrand, suggestCleanName } from '@/app/[locale]/submit/actions'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import type { SourceAttribution } from '@/lib/types/submission'
import { ImageUploadField } from '@/components/forms/image-upload-field'
import { ImageUploader } from '@/components/upload/ImageUploader'
import { TurnstileWidget } from '@/components/submit/TurnstileWidget'
import {
  trackSubmissionFormOpened,
  trackSubmissionCompleted,
} from '@/lib/analytics'

type SubmitFormProps = {
  source?: 'header_cta' | 'hero_cta' | 'footer_link'
}

export default function SubmitForm({
  source = 'hero_cta',
}: SubmitFormProps) {
  const t = useTranslations('submit')
  const tForm = useTranslations('submit.form')
  const tReview = useTranslations('submit.review')
  const router = useRouter()
  const sessionId = useMemo(() => crypto.randomUUID(), [])

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
      isOwner: false,
      sourceAttribution: undefined,
      pdpaConsent: false,
      turnstileToken: '',
      honeypot: '',
      socialLinks: { instagram: '', threads: '', facebook: '', pinkoi: '', shopee: '', website: '' },
      purchaseLinks: [],
      heroImageUrl: '',
      productPhotos: [],
    },
    mode: 'onTouched',
  })

  const isOwner = useWatch({ control, name: 'isOwner' })
  const pdpaConsent = useWatch({ control, name: 'pdpaConsent' })

  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [productPhotoUrls, setProductPhotoUrls] = useState<string[]>([])
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

  const handleProductPhotoUpload = useCallback((url: string) => {
    setProductPhotoUrls((prev) => {
      const next = [...prev, url].slice(0, 5)
      setValue('productPhotos', next, { shouldValidate: true })
      return next
    })
  }, [setValue])

  const handleProductPhotoRemove = useCallback((urlToRemove: string) => {
    setProductPhotoUrls((prev) => {
      const next = prev.filter((url) => url !== urlToRemove)
      setValue('productPhotos', next, { shouldValidate: true })
      return next
    })
  }, [setValue])

  function handleWebsiteBlur(value: string) {
    if (!value || !value.includes('?')) {
      setUrlSuggestion(null)
      return
    }

    const cleaned = value.split('?')[0]
    if (cleaned !== value && cleaned.length > 0) {
      setUrlSuggestion(cleaned)
    } else {
      setUrlSuggestion(null)
    }
  }

  const websiteRegistration = register('website')
  const nameRegistration = register('name')

  // eslint-disable-next-line react-hooks/refs
  const onSubmit = handleSubmit((data, event) => {
    setSubmitError(null)
    const formData =
      event?.currentTarget instanceof HTMLFormElement
        ? new FormData(event.currentTarget)
        : null
    const heroImageUrl = formData?.get('heroImageUrl')
    const productPhotos = formData?.get('productPhotos')

    startTransition(async () => {
      const result = await submitBrand({
        ...data,
        heroImageUrl: typeof heroImageUrl === 'string' ? heroImageUrl : data.heroImageUrl,
        productPhotos: typeof productPhotos === 'string' ? productPhotos : data.productPhotos,
      })
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
      <div className="mb-8">
        <h1 className="text-center font-heading text-[26px] font-bold text-foreground">
          {tForm('heading')}
        </h1>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-border bg-white p-8 shadow-sm"
        noValidate
      >
        <p className="mb-5 text-xs text-muted-foreground">
          <span className="text-destructive">*</span> {tForm('requiredHint')}
        </p>
        <div className="flex flex-col gap-5">
          {/* Brand Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="submit-name"
              className="block text-sm font-semibold text-foreground"
            >
              {tForm('brandNameLabel')} <span className="text-destructive">*</span>
            </label>
            <input
              id="submit-name"
              type="text"
              placeholder={tForm('brandNamePlaceholder')}
              className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
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
            <p className="text-xs text-muted-foreground">
              {tForm('brandNameHint')}
            </p>
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
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  {tForm('applySuggestion')}
                </button>
              </div>
            )}
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* Website URL */}
          <div className="space-y-1.5">
            <label
              htmlFor="submit-website"
              className="block text-sm font-semibold text-foreground"
            >
              {tForm('websiteLabel')} <span className="text-destructive">*</span>
            </label>
            <input
              id="submit-website"
              type="url"
              placeholder={tForm('websitePlaceholder')}
              className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
              {...websiteRegistration}
              onBlur={(event) => {
                websiteRegistration.onBlur(event)
                handleWebsiteBlur(event.target.value)
              }}
              onChange={(event) => {
                websiteRegistration.onChange(event)
                setUrlSuggestion(null)
              }}
            />
            {urlSuggestion && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white p-3 text-sm">
                <span>
                  {tForm('suggestedUrl')} <strong>{urlSuggestion}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setValue('website', urlSuggestion)
                    setUrlSuggestion(null)
                  }}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  {tForm('applySuggestion')}
                </button>
              </div>
            )}
            {errors.website && (
              <p className="text-xs text-destructive">{errors.website.message}</p>
            )}
          </div>

          {/* Hero image */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-foreground">
              {t('fields.heroImage')}
            </label>
            <ImageUploadField
              name="heroImageUrl"
              label=""
              uploadPath={`submissions/${sessionId}/hero`}
            />
            <p className="text-xs text-muted-foreground">
              {t('fields.heroImageHelper')}
            </p>
          </div>

          {/* Product photos */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-foreground">
              {t('fields.productPhotos')}
            </label>
            {productPhotoUrls.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {productPhotoUrls.map((url, index) => (
                  <div key={url} className="group relative aspect-square overflow-hidden rounded-md border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleProductPhotoRemove(url)}
                      aria-label={`${t('fields.productPhotos')} ${index + 1}`}
                      className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {productPhotoUrls.length < 5 && (
              <ImageUploader
                mode="multi"
                bucket="brand-images"
                path={`submissions/${sessionId}/photos`}
                value={[]}
                onUpload={handleProductPhotoUpload}
                maxFiles={Math.max(1, 5 - productPhotoUrls.length)}
              />
            )}
            <input type="hidden" name="productPhotos" value={JSON.stringify(productPhotoUrls)} />
            <p className="text-xs text-muted-foreground">
              {t('fields.productPhotosHelper')}
            </p>
          </div>


          {/* Source attribution */}
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
                  className={`h-11 w-full rounded-lg border border-border bg-white px-3 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 ${field.value ? 'text-foreground' : 'text-muted-foreground'}`}
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
              <p className="text-xs text-destructive">{errors.sourceAttribution.message}</p>
            )}
          </div>

          {/* Social links */}
          <div className="space-y-4">
            <p className="text-sm font-semibold text-foreground">{tForm('linksAccordionLabel')}</p>
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
                className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
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
                className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
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
                className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                {...register('socialLinks.facebook')}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="submit-pinkoi"
                className="block text-sm font-semibold text-foreground"
              >
                {tForm('pinkoiLabel')}
              </label>
              <input
                id="submit-pinkoi"
                type="url"
                placeholder="https://pinkoi.com/store/yourbrand"
                className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                {...register('socialLinks.pinkoi')}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="submit-shopee"
                className="block text-sm font-semibold text-foreground"
              >
                {tForm('shopeeLabel')}
              </label>
              <input
                id="submit-shopee"
                type="url"
                placeholder="https://shopee.tw/yourbrand"
                className="h-11 w-full rounded-lg border border-border bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                {...register('socialLinks.shopee')}
              />
            </div>
          </div>

          {/* Ownership card */}
          <div
            className="space-y-3 rounded-lg border border-border bg-[#F5F4F1] p-4"
            data-owner-selected={isOwner ? 'true' : 'false'}
          >
            <Controller
              name="isOwner"
              control={control}
              render={({ field }) => (
                <div className="flex min-h-[48px] items-start gap-3">
                  <input
                    id="submit-is-owner"
                    type="checkbox"
                    checked={field.value ?? false}
                    onChange={(e) => {
                      field.onChange(e.target.checked)
                    }}
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-border accent-primary"
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

          {/* PDPA consent */}
          <div className="space-y-2">
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
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-border accent-primary"
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
                    <p className="text-xs text-destructive">{fieldState.error.message}</p>
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
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="flex h-12 w-full items-center justify-center rounded-lg bg-cta px-6 text-sm font-semibold text-white hover:bg-cta/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? tForm('submittingButton') : tForm('submitButton')}
          </button>
        </div>
      </form>
    </div>
  )
}
