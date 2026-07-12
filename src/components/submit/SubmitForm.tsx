'use client'

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { TAIWAN_CITIES } from '@/lib/constants/taiwan-cities'
import {
  createOwnerSubmissionSchema,
  createRecommendationSubmissionSchema,
  type SubmissionFormData,
} from '@/lib/validations/submission'
import {
  submitOwnerBrand,
  submitRecommendation,
  suggestCleanName,
} from '@/app/[locale]/submit/actions'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import type { SourceAttribution } from '@/lib/types/submission'
import { FormField } from '@/components/forms/form-field'
import { StandardForm, StandardFormStack } from '@/components/forms/form-layout'
import { ImageUploadField } from '@/components/forms/image-upload-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { TurnstileWidget } from '@/components/submit/TurnstileWidget'
import { cn } from '@/lib/utils'
import {
  trackSubmissionCompleted,
  trackSubmissionFormOpened,
} from '@/lib/analytics'

type SubmitFormProps = {
  source?: 'header_cta' | 'hero_cta' | 'footer_link'
  variant?: 'recommend' | 'owner'
}

export default function SubmitForm({
  source = 'hero_cta',
  variant = 'recommend',
}: SubmitFormProps) {
  const t = useTranslations('submit')
  const tForm = useTranslations(`submit.${variant}Form`)
  const tCities = useTranslations('cities')
  const tReview = useTranslations('submit.review')
  const router = useRouter()
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const mountTimeRef = useRef<number | null>(null)
  const nameBlurRequestRef = useRef(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState(false)

  const tSchema = useMemo(
    () => (key: string) => t(key as Parameters<typeof t>[0]),
    [t],
  )
  const schema = useMemo(
    () =>
      variant === 'owner'
        ? createOwnerSubmissionSchema(tSchema)
        : createRecommendationSubmissionSchema(tSchema),
    [tSchema, variant],
  )
  const resolver = useMemo(
    () => zodResolver(schema as never) as Resolver<SubmissionFormData>,
    [schema],
  )

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isValid },
  } = useForm<SubmissionFormData>({
    resolver,
    defaultValues: {
      name: '',
      website: '',
      description: '',
      guestEmail: '',
      sourceAttribution: undefined,
      city: undefined,
      mitSmileCert: '',
      pdpaConsent: false,
      turnstileToken: '',
      honeypot: '',
      socialLinks: {
        instagram: '',
        threads: '',
        facebook: '',
        pinkoi: '',
        shopee: '',
        website: '',
      },
      purchaseLinks: [],
      heroImageUrl: '',
    },
    mode: 'onTouched',
  })

  const pdpaConsent = useWatch({ control, name: 'pdpaConsent' })
  const watchedCity = useWatch({ control, name: 'city' })
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    mountTimeRef.current = Date.now()
    trackSubmissionFormOpened(
      source,
      variant === 'owner' ? 'owner_claim' : 'recommend',
    )
  }, [source, variant])

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
    (token: string) => {
      setTurnstileError(false)
      setValue('turnstileToken', token, { shouldValidate: true })
    },
    [setValue],
  )

  const handleTurnstileError = useCallback(() => {
    setTurnstileError(true)
  }, [])

  const handleTurnstileExpire = useCallback(() => {
    setValue('turnstileToken', '', { shouldValidate: true })
  }, [setValue])

  function handleWebsiteBlur(value: string) {
    if (!value || !value.includes('?')) {
      setUrlSuggestion(null)
      return
    }

    const cleaned = value.split('?')[0]
    setUrlSuggestion(cleaned !== value && cleaned.length > 0 ? cleaned : null)
  }

  const websiteRegistration = register('website')
  const nameRegistration = register('name')

  useEffect(() => {
    if (!pendingRedirect) return

    const timeout = setTimeout(() => {
      router.push(pendingRedirect)
      setPendingRedirect(null)
    }, 0)

    return () => clearTimeout(timeout)
  }, [pendingRedirect, router])

  const submitForm = useCallback(
    async (data: SubmissionFormData) => {
      if (isSubmitting) return

      setSubmitError(null)
      setIsSubmitting(true)

      try {
        const result:
          | { error?: string; ownershipAdjusted?: boolean }
          | undefined =
          variant === 'owner'
            ? await submitOwnerBrand(data)
            : await submitRecommendation(data)

        if (result?.error) {
          setSubmitError(result.error)
          return
        }

        const query = new URLSearchParams({
          intent: variant === 'owner' ? 'owner_claim' : 'recommend',
        })
        if (result?.ownershipAdjusted) {
          query.set('ownership', 'community')
        }
        setPendingRedirect(`/submit/confirmation?${query.toString()}`)

        if (mountTimeRef.current !== null) {
          const elapsed = Math.round((Date.now() - mountTimeRef.current) / 1000)
          trackSubmissionCompleted(
            data.name,
            '',
            Boolean(data.heroImageUrl),
            elapsed,
            variant === 'owner' ? 'owner_claim' : 'recommend',
            !data.guestEmail && variant === 'recommend',
          )
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, variant],
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      void handleSubmit(submitForm)(event)
    },
    [handleSubmit, submitForm],
  )

  const isSubmitDisabled = !isValid || !pdpaConsent || isSubmitting

  return (
    <div className="page-gutter mx-auto max-w-2xl py-12">
      <div className="mb-8">
        <h1 className="text-balance text-center type-page-title">
          {tForm('heading')}
        </h1>
        <p className="mt-3 text-center type-card-description">
          {tForm('subheading')}
        </p>
      </div>

      <StandardForm onSubmit={onSubmit} noValidate>
        <p className="mb-5 type-caption">
          <span className="text-destructive">*</span> {tForm('requiredHint')}
        </p>

        <StandardFormStack>
          <FormField
            id="submit-name"
            label={tForm('brandNameLabel')}
            description={tForm('brandNameHint')}
            error={errors.name?.message}
            required
          >
            <Input
              id="submit-name"
              type="text"
              autoComplete="off"
              placeholder={tForm('brandNamePlaceholder')}
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
            {nameSuggestion ? (
              <div className="overflow-hidden transition-all duration-200">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
                  <span>
                    {tForm('suggestedName')} <strong>{nameSuggestion}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setValue('name', nameSuggestion)
                      setNameSuggestion(null)
                    }}
                  >
                    {tForm('applySuggestion')}
                  </Button>
                </div>
              </div>
            ) : null}
          </FormField>

          <FormField
            id="submit-website"
            label={tForm('websiteLabel')}
            description={tForm('websiteHint')}
            error={errors.website?.message}
            required
          >
            <Input
              id="submit-website"
              type="url"
              autoComplete="off"
              placeholder={tForm('websitePlaceholder')}
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
            {urlSuggestion ? (
              <div className="overflow-hidden transition-all duration-200">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
                  <span>
                    {tForm('suggestedUrl')} <strong>{urlSuggestion}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setValue('website', urlSuggestion)
                      setUrlSuggestion(null)
                    }}
                  >
                    {tForm('applySuggestion')}
                  </Button>
                </div>
              </div>
            ) : null}
          </FormField>

          {variant === 'recommend' ? (
            <FormField
              id="submit-guest-email"
              label={tForm('guestEmailLabel')}
              description={tForm('guestEmailHint')}
              error={errors.guestEmail?.message}
            >
              <Input
                id="submit-guest-email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                placeholder={tForm('guestEmailPlaceholder')}
                {...register('guestEmail')}
              />
            </FormField>
          ) : null}

          <FormField
            id="submit-description"
            label={tForm('descriptionLabel')}
            description={tForm('descriptionHint')}
            error={errors.description?.message}
            required={variant === 'owner'}
          >
            <Textarea
              id="submit-description"
              rows={4}
              required={variant === 'owner'}
              placeholder={tForm('descriptionPlaceholder')}
              {...register('description')}
            />
          </FormField>

          <Controller
            name="heroImageUrl"
            control={control}
            render={({ field, fieldState }) => (
              <ImageUploadField
                name={field.name}
                label={t('fields.heroImage')}
                description={
                  variant === 'owner'
                    ? tForm('heroImageHintOwner')
                    : tForm('heroImageHintRecommend')
                }
                uploadPath={`submissions/${sessionId}/hero`}
                value={field.value ?? ''}
                onChange={(value) => field.onChange(value)}
                required={variant === 'owner'}
                error={fieldState.error?.message}
              />
            )}
          />

          {variant === 'recommend' ? (
            <FormField
              id="submit-source"
              label={tForm('sourceLabel')}
              description={tForm('sourceHint')}
              error={errors.sourceAttribution?.message}
              required
            >
              <Controller
                name="sourceAttribution"
                control={control}
                render={({ field }) => (
                  <NativeSelect
                    id="submit-source"
                    className={cn(
                      field.value ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    value={field.value ?? ''}
                    onChange={(event) =>
                      field.onChange(
                        (event.target.value as SourceAttribution) || undefined,
                      )
                    }
                  >
                    <option value="" disabled>
                      {tForm('sourcePlaceholder')}
                    </option>
                    {SOURCE_ATTRIBUTION_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {t(`attribution.${value}` as Parameters<typeof t>[0])}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              />
            </FormField>
          ) : null}

          {variant === 'owner' ? (
            <>
              <FormField
                id="submit-city"
                label={t('city')}
                description={tForm('cityHint')}
              >
                <NativeSelect
                  id="submit-city"
                  className={cn(
                    !watchedCity && 'text-muted-foreground',
                  )}
                  {...register('city', {
                    setValueAs: (value) => (value === '' ? undefined : value),
                  })}
                >
                  <option value="">{t('cityPlaceholder')}</option>
                  {TAIWAN_CITIES.map((city) => (
                    <option key={city.slug} value={city.slug}>
                      {tCities(city.slug)}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>

              <FormField
                label={tForm('linksHeading')}
                description={tForm('linksHint')}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="submit-instagram"
                    label={tForm('instagramLabel')}
                  >
                    <Input
                      id="submit-instagram"
                      type="url"
                      autoComplete="off"
                      placeholder="https://instagram.com/yourbrand"
                      {...register('socialLinks.instagram')}
                    />
                  </FormField>
                  <FormField id="submit-threads" label={tForm('threadsLabel')}>
                    <Input
                      id="submit-threads"
                      type="url"
                      autoComplete="off"
                      placeholder="https://threads.net/@yourbrand"
                      {...register('socialLinks.threads')}
                    />
                  </FormField>
                  <FormField
                    id="submit-facebook"
                    label={tForm('facebookLabel')}
                  >
                    <Input
                      id="submit-facebook"
                      type="url"
                      autoComplete="off"
                      placeholder="https://facebook.com/yourbrand"
                      {...register('socialLinks.facebook')}
                    />
                  </FormField>
                  <FormField id="submit-pinkoi" label={tForm('pinkoiLabel')}>
                    <Input
                      id="submit-pinkoi"
                      type="url"
                      autoComplete="off"
                      placeholder="https://pinkoi.com/store/yourbrand"
                      {...register('socialLinks.pinkoi')}
                    />
                  </FormField>
                  <FormField id="submit-shopee" label={tForm('shopeeLabel')}>
                    <Input
                      id="submit-shopee"
                      type="url"
                      autoComplete="off"
                      placeholder="https://shopee.tw/yourbrand"
                      {...register('socialLinks.shopee')}
                    />
                  </FormField>
                </div>
              </FormField>

              <FormField
                id="submit-mit-smile-cert"
                label={t('fields.mitSmileMarkNumber')}
                description={t('fields.mitSmileMarkNumberHint')}
              >
                <Input
                  id="submit-mit-smile-cert"
                  type="text"
                  autoComplete="off"
                  placeholder={t('fields.mitSmileMarkNumberPlaceholder')}
                  {...register('mitSmileCert')}
                />
              </FormField>
            </>
          ) : null}

          <div className="space-y-2">
            <Controller
              name="pdpaConsent"
              control={control}
              render={({ field, fieldState }) => (
                <div className="space-y-1">
                  <Label className="flex min-h-12 cursor-pointer items-start gap-3">
                    <Checkbox
                      id="submit-pdpa"
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked)}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="type-body">
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
                  </Label>
                  {fieldState.error ? (
                    <p className="text-xs text-destructive">
                      {fieldState.error.message}
                    </p>
                  ) : null}
                </div>
              )}
            />
          </div>

          <input
            type="text"
            {...register('honeypot')}
            tabIndex={-1}
            autoComplete="off"
            // eslint-disable-next-line no-restricted-syntax -- ui-exception: honeypot trap must be invisible native input
            className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
            aria-hidden="true"
          />

          <div className="flex justify-center">
            <TurnstileWidget
              onSuccess={handleTurnstileSuccess}
              onError={handleTurnstileError}
              onExpire={handleTurnstileExpire}
            />
          </div>
          {turnstileError ? (
            <p className="text-sm text-destructive" role="alert">
              {t('errors.turnstileError')}
            </p>
          ) : null}

          {submitError ? (
            <p
              role="alert"
              className="text-sm text-destructive"
              aria-live="polite"
            >
              {submitError}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary" tone="cta"
            disabled={isSubmitDisabled}
            className="w-full"
          >
            {isSubmitting ? tForm('submittingButton') : tForm('submitButton')}
          </Button>
        </StandardFormStack>
      </StandardForm>
    </div>
  )
}
