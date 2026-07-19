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
import { ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  createRecommendationSubmissionSchema,
  type SubmissionFormData,
} from '@/lib/validations/submission'
import {
  inspectRecommendationName,
  submitRecommendation,
} from '@/app/[locale]/submit/actions'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import type { SourceAttribution } from '@/lib/types/submission'
import { FormField } from '@/components/forms/form-field'
import { StandardForm } from '@/components/forms/form-layout'
import { MarketingEmailOptInField } from '@/components/forms/marketing-email-opt-in-field'
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
}

export default function SubmitForm({
  source = 'hero_cta',
}: SubmitFormProps) {
  const t = useTranslations('submit')
  const tForm = useTranslations('submit.recommendForm')
  const tReview = useTranslations('submit.review')
  const router = useRouter()
  const mountTimeRef = useRef<number | null>(null)
  const nameBlurRequestRef = useRef(0)
  const submitLockRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState(false)

  const tSchema = useMemo(
    () => (key: string) => t(key as Parameters<typeof t>[0]),
    [t],
  )
  const schema = useMemo(
    () => createRecommendationSubmissionSchema(tSchema),
    [tSchema],
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
      marketingEmailOptIn: false,
      sourceAttribution: undefined,
      pdpaConsent: false,
      turnstileToken: '',
      honeypot: '',
    },
    mode: 'onTouched',
  })

  const pdpaConsent = useWatch({ control, name: 'pdpaConsent' })
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const [nameDuplicate, setNameDuplicate] = useState(false)
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    mountTimeRef.current = Date.now()
    trackSubmissionFormOpened(source, 'recommend')
  }, [source])

  const handleNameBlur = async () => {
    const currentName = getValues('name')
    if (!currentName || currentName.length < 2) return

    const requestId = ++nameBlurRequestRef.current
    try {
      const result = await inspectRecommendationName(currentName)
      if (requestId !== nameBlurRequestRef.current) return
      setNameDuplicate(result.hasDuplicate)
      if (result.changed && result.suggestion) {
        setNameSuggestion(result.suggestion)
      } else {
        setNameSuggestion(null)
      }
    } catch {
      if (requestId === nameBlurRequestRef.current) {
        setNameSuggestion(null)
        setNameDuplicate(false)
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
      if (submitLockRef.current) return
      submitLockRef.current = true

      setSubmitError(null)
      setIsSubmitting(true)

      try {
        const result:
          | { error?: string; ownershipAdjusted?: boolean }
          | undefined = await submitRecommendation(data)

        if (result?.error) {
          setSubmitError(result.error)
          return
        }

        const query = new URLSearchParams({
          intent: 'recommend',
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
            'recommend',
            !data.guestEmail,
          )
        }
      } finally {
        submitLockRef.current = false
        setIsSubmitting(false)
      }
    },
    [],
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      void handleSubmit(submitForm)(event)
    },
    [handleSubmit, submitForm],
  )

  const isSubmitDisabled =
    !isValid || !pdpaConsent || nameDuplicate || isSubmitting

  return (
    <div className="page-gutter mx-auto max-w-3xl py-20">
      <div className="mb-10">
        <h1 className="text-balance text-center type-page-title-large">
          {tForm('heading')}
        </h1>
        <span
          className="mx-auto mt-4 block h-0.5 w-8 bg-cta"
          aria-hidden="true"
        />
        <p className="mt-4 text-center type-body-muted">
          {tForm('subheading')}
        </p>
      </div>

      <StandardForm onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-5">
          <p className="type-caption">
            <span className="text-destructive">*</span> {tForm('requiredHint')}
          </p>

          <div className="grid gap-5 md:grid-cols-2">
            <FormField
              id="submit-name"
              label={tForm('brandNameLabel')}
              description={tForm('brandNameHint')}
              error={
                errors.name?.message ??
                (nameDuplicate ? t('fields.nameDuplicateTitle') : undefined)
              }
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
                  nameBlurRequestRef.current += 1
                  setNameSuggestion(null)
                  setNameDuplicate(false)
                  setSubmitError(null)
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
          </div>

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

          <div className="grid gap-5 md:grid-cols-2">
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
              <Controller
                name="marketingEmailOptIn"
                control={control}
                render={({ field }) => (
                  <MarketingEmailOptInField
                    id="submit-marketing-email"
                    variant="newsletter-only"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </FormField>

            <FormField
              id="submit-description"
              label={tForm('descriptionLabel')}
              description={tForm('descriptionHint')}
              error={errors.description?.message}
            >
              <Textarea
                id="submit-description"
                rows={4}
                placeholder={tForm('descriptionPlaceholder')}
                {...register('description')}
              />
            </FormField>
          </div>

          <div
            data-testid="consent-panel"
            className="flex items-start gap-4 rounded-lg border border-border bg-muted/50 p-5"
          >
            <span
              data-testid="consent-shield"
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground"
            >
              <ShieldCheck className="size-5" />
            </span>
            <div className="space-y-3">
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
                        className="mt-0.5 size-[18px] shrink-0"
                        aria-required="true"
                      />
                      <span className="type-body font-normal">
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
                        <span aria-hidden="true" className="text-destructive">
                          {' '}
                          *
                        </span>
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
        </div>
      </StandardForm>
    </div>
  )
}
