'use client'

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { submitOwnerQuick, suggestCleanName } from '@/app/[locale]/submit/actions'
import { FormField } from '@/components/forms/form-field'
import { StandardForm, StandardFormStack } from '@/components/forms/form-layout'
import { MarketingEmailOptInField } from '@/components/forms/marketing-email-opt-in-field'
import { TurnstileWidget } from '@/components/submit/TurnstileWidget'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useRouter } from '@/i18n/navigation'
import {
  trackSubmissionCompleted,
  trackSubmissionFormOpened,
} from '@/lib/analytics'

type Translator = (key: string) => string

function createQuickSubmissionSchema(t: Translator) {
  return z.object({
    name: z.string().min(1, t('validation.nameMinLength')),
    romanizedName: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-zA-Z0-9\s\-'.]+$/)
      .optional()
      .or(z.literal('')),
    website: z.string().url(t('validation.urlInvalid')),
    description: z.string().min(1, t('validation.descriptionRequired')),
    pdpaConsent: z.literal(true, {
      error: t('validation.pdpaRequired'),
    }),
    marketingEmailOptIn: z.boolean(),
    turnstileToken: z.string().min(1, t('validation.turnstileRequired')),
    honeypot: z.string(),
  })
}

type QuickSubmissionFormData = z.infer<
  ReturnType<typeof createQuickSubmissionSchema>
>

export default function SubmitQuickForm() {
  const t = useTranslations('submit')
  const tReview = useTranslations('submit.review')
  const router = useRouter()
  const mountTimeRef = useRef<number | null>(null)
  const nameBlurRequestRef = useRef(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState(false)

  const tSchema = useMemo(
    () => (key: string) => t(key as Parameters<typeof t>[0]),
    [t],
  )
  const schema = useMemo(() => createQuickSubmissionSchema(tSchema), [tSchema])

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isValid },
  } = useForm<QuickSubmissionFormData>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      romanizedName: '',
      website: '',
      description: '',
      pdpaConsent: false as QuickSubmissionFormData['pdpaConsent'],
      marketingEmailOptIn: false,
      turnstileToken: '',
      honeypot: '',
    },
  })

  const pdpaConsent = useWatch({ control, name: 'pdpaConsent' })
  const nameRegistration = register('name')
  const websiteRegistration = register('website')

  useEffect(() => {
    mountTimeRef.current = Date.now()
    // Remove these casts when the shared analytics helper adopts the quick-form taxonomy.
    trackSubmissionFormOpened(
      'quick' as Parameters<typeof trackSubmissionFormOpened>[0],
      'owner' as Parameters<typeof trackSubmissionFormOpened>[1],
    )
  }, [])

  useEffect(() => {
    if (!pendingRedirect) return

    const timeout = setTimeout(() => {
      router.push(pendingRedirect)
      setPendingRedirect(null)
    }, 0)

    return () => clearTimeout(timeout)
  }, [pendingRedirect, router])

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

  function handleWebsiteBlur(value: string) {
    if (!value || !value.includes('?')) {
      setUrlSuggestion(null)
      return
    }

    const cleaned = value.split('?')[0]
    setUrlSuggestion(cleaned !== value && cleaned.length > 0 ? cleaned : null)
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
    setValue('turnstileToken', '', { shouldValidate: true })
  }, [setValue])

  const handleTurnstileExpire = useCallback(() => {
    setValue('turnstileToken', '', { shouldValidate: true })
  }, [setValue])

  const submitForm = useCallback(
    async (data: QuickSubmissionFormData) => {
      if (isSubmitting) return

      setSubmitError(null)
      setIsSubmitting(true)

      try {
        const result = await submitOwnerQuick(data)
        if (result?.error) {
          setSubmitError(result.error)
          return
        }

        setPendingRedirect('/submit/confirmation?intent=owner_claim')

        if (mountTimeRef.current !== null) {
          const elapsed = Math.round((Date.now() - mountTimeRef.current) / 1000)
          trackSubmissionCompleted(
            data.name,
            '',
            false,
            elapsed,
            'owner_claim',
          )
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting],
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
          {t('quickForm.heading')}
        </h1>
        <p className="mt-3 text-center type-card-description">
          {t('quickForm.subheading')}
        </p>
      </div>

      <StandardForm onSubmit={onSubmit} noValidate>
        <StandardFormStack>
          <FormField
            id="submit-name"
            label={t('fields.brandName')}
            error={errors.name?.message}
            required
          >
            <Input
              id="submit-name"
              type="text"
              autoComplete="off"
              placeholder={t('fields.brandNamePlaceholder')}
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
                    {t('ownerForm.suggestedName')}{' '}
                    <strong>{nameSuggestion}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setValue('name', nameSuggestion, {
                        shouldValidate: true,
                      })
                      setNameSuggestion(null)
                    }}
                  >
                    {t('ownerForm.applySuggestion')}
                  </Button>
                </div>
              </div>
            ) : null}
          </FormField>

          <FormField
            id="submit-romanized-name"
            label={t('ownerForm.romanizedNameLabel')}
            description={t('ownerForm.romanizedNameHint')}
            error={errors.romanizedName?.message}
          >
            <Input
              id="submit-romanized-name"
              type="text"
              autoComplete="off"
              placeholder={t('ownerForm.romanizedNamePlaceholder')}
              {...register('romanizedName')}
            />
          </FormField>

          <FormField
            id="submit-website"
            label={t('ownerForm.websiteLabel')}
            error={errors.website?.message}
            required
          >
            <Input
              id="submit-website"
              type="url"
              autoComplete="off"
              placeholder={t('ownerForm.websitePlaceholder')}
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
                    {t('ownerForm.suggestedUrl')}{' '}
                    <strong>{urlSuggestion}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setValue('website', urlSuggestion, {
                        shouldValidate: true,
                      })
                      setUrlSuggestion(null)
                    }}
                  >
                    {t('ownerForm.applySuggestion')}
                  </Button>
                </div>
              </div>
            ) : null}
          </FormField>

          <FormField
            id="submit-description"
            label={t('ownerForm.descriptionLabel')}
            error={errors.description?.message}
            required
          >
            <Textarea
              id="submit-description"
              rows={4}
              placeholder={t('ownerForm.descriptionPlaceholder')}
              {...register('description')}
            />
          </FormField>

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
                      className="mt-0.5 size-[18px] shrink-0"
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

          <Controller
            name="marketingEmailOptIn"
            control={control}
            render={({ field }) => (
              <MarketingEmailOptInField
                id="submit-marketing-email"
                variant="newsletter-only"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />

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
            variant="primary"
            tone="cta"
            disabled={isSubmitDisabled}
            className="w-full"
          >
            {isSubmitting
              ? t('quickForm.submittingButton')
              : t('quickForm.submitButton')}
          </Button>
        </StandardFormStack>
      </StandardForm>
    </div>
  )
}
