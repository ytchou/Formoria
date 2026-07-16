'use client'

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Controller,
  useForm,
} from 'react-hook-form'
import { z } from 'zod'
import { submitOwnerDetailedBrand } from '@/app/[locale]/submit/actions'
import { useWizardController } from '@/components/brand-wizard/use-wizard-controller'
import { WizardFooter } from '@/components/dashboard/wizard-footer'
import { WizardSidebar } from '@/components/dashboard/wizard-sidebar'
import { TurnstileWidget } from '@/components/submit/TurnstileWidget'
import { MarketingEmailOptInField } from '@/components/forms/marketing-email-opt-in-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/navigation'
import {
  trackSubmissionCompleted,
  trackSubmissionFormOpened,
} from '@/lib/analytics'
import type { WizardStep } from '@/lib/schemas/brand-edit'
import {
  SUBMISSION_SECTION_FIELDS,
  SUBMISSION_WIZARD_STEPS,
  type SubmissionWizardStepKey,
  submissionWizardRequiredSchema,
  submissionWizardSchema,
} from '@/lib/schemas/submission-wizard'
import {
  SubmissionWizardContext,
  type SubmissionWizardValues,
} from './submission-wizard-context'
import { BasicInfoSection } from './sections/BasicInfoSection'
import { LinksSection } from './sections/LinksSection'
import { LocationsSection } from './sections/LocationsSection'
import { MediaSection } from './sections/MediaSection'

type SubmissionWizardProps = {
  productTagSuggestions?: string[]
}

const submissionStepFormSchema = submissionWizardSchema.and(
  z.object({
    pdpaConsent: z.boolean(),
    marketingEmailOptIn: z.boolean(),
    turnstileToken: z.string(),
    honeypot: z.string(),
  }),
)

const submissionFormSchema = submissionWizardRequiredSchema.and(
  z.object({
    pdpaConsent: z.literal(true),
    marketingEmailOptIn: z.boolean().default(false),
    turnstileToken: z.string().min(1),
    honeypot: z.string(),
  }),
)

const SIDEBAR_STEPS: WizardStep[] = SUBMISSION_WIZARD_STEPS.map((step) => ({
  key: step.key,
}))

const FIELD_STEPS: Partial<Record<keyof SubmissionWizardValues, number>> = {
  name: 0,
  romanizedName: 0,
  website: 0,
  description: 0,
  productType: 0,
  foundingYear: 0,
  productTags: 0,
  city: 0,
  priceRange: 0,
  mitStory: 0,
  heroImageUrl: 1,
  productPhotos: 1,
  socialInstagram: 2,
  socialThreads: 2,
  socialFacebook: 2,
  purchaseWebsite: 2,
  purchasePinkoi: 2,
  purchaseShopee: 2,
  otherUrls: 2,
  retailLocations: 3,
  pdpaConsent: 3,
  marketingEmailOptIn: 3,
  turnstileToken: 3,
  honeypot: 3,
}

export default function SubmissionWizard({
  productTagSuggestions = [],
}: SubmissionWizardProps) {
  const t = useTranslations('submit')
  const tReview = useTranslations('submit.review')
  const router = useRouter()
  const uploadSessionId = useId().replaceAll(':', '')
  const mountTimeRef = useRef<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState(false)

  const resolver = useMemo(
    () => zodResolver(submissionStepFormSchema),
    [],
  )
  const form = useForm<SubmissionWizardValues>({
    resolver,
    defaultValues: {
      name: '',
      romanizedName: '',
      website: '',
      description: '',
      productType: undefined,
      foundingYear: undefined,
      productTags: [],
      city: undefined,
      priceRange: undefined,
      mitStory: '',
      heroImageUrl: '',
      productPhotos: [],
      socialInstagram: '',
      socialThreads: '',
      socialFacebook: '',
      purchaseWebsite: '',
      purchasePinkoi: '',
      purchaseShopee: '',
      otherUrls: [],
      retailLocations: [],
      pdpaConsent: false,
      marketingEmailOptIn: false,
      turnstileToken: '',
      honeypot: '',
    },
    mode: 'onTouched',
  })

  const contextValue = useMemo(
    () => ({ form, productTagSuggestions, uploadSessionId }),
    [form, productTagSuggestions, uploadSessionId],
  )

  useEffect(() => {
    mountTimeRef.current = Date.now()
    trackSubmissionFormOpened('hero_cta', 'owner_claim')
  }, [])

  const validateStep = useCallback(async (stepKey: SubmissionWizardStepKey) => {
    const sectionFields = SUBMISSION_SECTION_FIELDS[stepKey] ?? []
    let isValid = await form.trigger(sectionFields)
    if (stepKey === 'media' && !form.getValues('heroImageUrl')) {
      form.setError('heroImageUrl', { type: 'required' })
      isValid = false
    }
    return isValid
  }, [form])

  const {
    activeStep,
    completedSteps,
    currentStepKey,
    navigateTo,
    goToStep,
    continueToNext,
    goBack,
  } = useWizardController({
    steps: SUBMISSION_WIZARD_STEPS,
    validateStep,
  })

  const submitForm = useCallback(
    async (values: SubmissionWizardValues) => {
      if (isSubmitting) return

      setSubmitError(null)
      setIsSubmitting(true)
      try {
        const result = await submitOwnerDetailedBrand(values)
        if (result?.error) {
          setSubmitError(result.error)
          return
        }

        if (mountTimeRef.current !== null) {
          trackSubmissionCompleted(
            values.name,
            values.productType ?? '',
            Boolean(values.heroImageUrl),
            Math.round((Date.now() - mountTimeRef.current) / 1000),
            'owner_claim',
          )
        }

        const params = new URLSearchParams({ intent: 'owner_claim' })
        if (result?.ownershipAdjusted) {
          params.set('ownership', 'community')
        }
        router.push(`/submit/confirmation?${params.toString()}`)
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, router],
  )

  const handlePublish = useCallback(async () => {
    const result = submissionFormSchema.safeParse(form.getValues())
    if (!result.success) {
      const invalidFields = result.error.issues
        .map((issue) => issue.path.at(0))
        .filter(
          (field): field is keyof SubmissionWizardValues =>
            typeof field === 'string',
        )

      for (const field of invalidFields) {
        form.setError(field, { type: 'validation' })
      }

      const firstInvalidField = invalidFields.at(0)
      if (firstInvalidField) {
        navigateTo(FIELD_STEPS[firstInvalidField] ?? 0)
      }
      return
    }

    await submitForm(result.data)
  }, [form, navigateTo, submitForm])

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void handlePublish()
    },
    [handlePublish],
  )

  const section = (() => {
    switch (currentStepKey) {
      case 'media':
        return <MediaSection />
      case 'links':
        return <LinksSection />
      case 'locations':
        return <LocationsSection />
      case 'basicInfo':
        return <BasicInfoSection />
    }
  })()

  return (
    <SubmissionWizardContext.Provider value={contextValue}>
      <form onSubmit={onSubmit} noValidate>
        <div className="flex min-h-screen gap-6">
          <WizardSidebar
            steps={SIDEBAR_STEPS}
            activeStep={activeStep}
            completedSteps={completedSteps}
            onStepClick={(targetStep) => void goToStep(targetStep)}
          />

          <main className="min-w-0 flex-1 pb-20">
            {section}

            {activeStep === SUBMISSION_WIZARD_STEPS.length - 1 ? (
              <>
                <div className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6">
                  <Controller
                    name="pdpaConsent"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <div className="space-y-1">
                        <Label className="flex min-h-12 cursor-pointer items-start gap-3">
                          <Checkbox
                            id="submission-pdpa"
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              field.onChange(checked)
                            }
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
                          <p className="type-error">
                            {t('validation.pdpaRequired')}
                          </p>
                        ) : null}
                      </div>
                    )}
                  />

                  <Controller
                    name="marketingEmailOptIn"
                    control={form.control}
                    render={({ field }) => (
                      <MarketingEmailOptInField
                        id="submission-marketing-email"
                        variant="newsletter-and-lifecycle"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />

                  <input
                    type="text"
                    {...form.register('honeypot')}
                    tabIndex={-1}
                    autoComplete="off"
                    // eslint-disable-next-line no-restricted-syntax -- ui-exception: honeypot trap must be invisible native input
                    className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
                    aria-hidden="true"
                  />

                  <div className="flex justify-center">
                    <TurnstileWidget
                      onSuccess={(token) => {
                        setTurnstileError(false)
                        form.setValue('turnstileToken', token, {
                          shouldValidate: true,
                        })
                      }}
                      onError={() => setTurnstileError(true)}
                      onExpire={() => {
                        form.setValue('turnstileToken', '', {
                          shouldValidate: true,
                        })
                      }}
                    />
                  </div>
                  {turnstileError || form.formState.errors.turnstileToken ? (
                    <p className="type-error text-center" role="alert">
                      {turnstileError
                        ? t('errors.turnstileError')
                        : t('validation.turnstileRequired')}
                    </p>
                  ) : null}

                  {submitError ? (
                    <p className="type-error" role="alert" aria-live="polite">
                      {submitError}
                    </p>
                  ) : null}
                </div>

                <footer className="mt-8 flex items-center justify-between border-t border-border pt-6">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isSubmitting}
                    onClick={goBack}
                  >
                    {t('submissionWizard.backButton')}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    tone="cta"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {t('submissionWizard.submittingButton')}
                      </>
                    ) : (
                      t('submissionWizard.submitButton')
                    )}
                  </Button>
                </footer>
              </>
            ) : (
              <WizardFooter
                activeStep={activeStep}
                totalSteps={SUBMISSION_WIZARD_STEPS.length}
                isSaving={false}
                onBack={goBack}
                onSaveAndContinue={() => void continueToNext()}
                onSave={() => undefined}
                onPublish={() => undefined}
              />
            )}
          </main>
        </div>
      </form>
    </SubmissionWizardContext.Provider>
  )
}
