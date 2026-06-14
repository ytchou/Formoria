'use client'

import { useState, useMemo, useTransition, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useForm, FormProvider, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, Send } from 'lucide-react'
import { StepIndicator } from './StepIndicator'
import { UrlStep } from './UrlStep'
import type { UrlStepLinks } from './UrlStep'
import { BrandInfoStep } from './BrandInfoStep'
import { ProductsStep } from './ProductsStep'
import { LinksStep } from './LinksStep'
import { ReviewStep } from './ReviewStep'
import {
  getBrandInfoSchema,
  getProductsSchema,
  getLinksSchema,
  getReviewSchema,
  getFullSubmissionSchema,
  type SubmissionFormData,
} from '@/lib/validations/submission'
import { useRouter } from '@/i18n/navigation'
import { submitBrand } from '@/app/[locale]/submit/actions'
import {
  trackSubmissionFormOpened,
  trackSubmissionFormStepCompleted,
  trackSubmissionCompleted,
  trackSubmissionFormAbandoned,
  SUBMISSION_STEP_NAMES,
  type SubmissionStepName,
} from '@/lib/analytics'
import type { TaxonomyTag } from '@/lib/types'
import type { ScrapedBrandData, PhotoItem } from '@/lib/types/scraper'
import type { SourceAttribution } from '@/lib/types/submission'

const STEP_COUNT = 4

const STEP_FIELDS: (keyof SubmissionFormData)[][] = [
  [
    'name',
    'description',
    'category',
    'region',
    'valueTags',
    'logoUrl',
  ],
  ['productPhotos', 'brandHighlights'],
  ['retailLocations'],
  ['pdpaConsent'],
]

type Category = {
  slug: string
  label?: string
  name?: string
  labelZh?: string
  nameZh?: string | null
}

type SubmitWizardProps = {
  categories: Category[]
  regionTags?: TaxonomyTag[]
  valueTags?: TaxonomyTag[]
  source?: 'header_cta' | 'hero_cta' | 'footer_link'
}

type WizardPhase = 'url' | 'form'

function mapScrapedToPhotos(data: ScrapedBrandData): PhotoItem[] {
  const photos: PhotoItem[] = []

  if (data.heroImageUrl) {
    photos.push({
      id: crypto.randomUUID(),
      url: data.heroImageUrl,
      source: 'scraped',
    })
  }

  for (const url of data.galleryImageUrls) {
    if (url !== data.heroImageUrl) {
      photos.push({
        id: crypto.randomUUID(),
        url,
        source: 'scraped',
      })
    }
  }

  return photos
}

export function SubmitWizard({
  categories,
  regionTags = [],
  valueTags = [],
  source = 'hero_cta',
}: SubmitWizardProps) {
  const t = useTranslations('submit')
  const router = useRouter()

  // Wrap to satisfy the plain (key: string) => string Translator contract
  const tSchema = useMemo(
    () => (key: string) => t(key as Parameters<typeof t>[0]),
    [t]
  )

  const stepSchemas = useMemo(
    () => [
      getBrandInfoSchema(tSchema),
      getProductsSchema(tSchema),
      getLinksSchema(tSchema),
      getReviewSchema(tSchema),
    ],
    [tSchema]
  )
  const [phase, setPhase] = useState<WizardPhase>('url')
  const [currentStep, setCurrentStep] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [completed, setCompleted] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [sourceAttribution, setSourceAttribution] = useState<SourceAttribution | undefined>(undefined)

  const mountTimeRef = useRef<number>(0)
  const lastStepRef = useRef<SubmissionStepName>(SUBMISSION_STEP_NAMES[0])

  const sessionId = useMemo(() => crypto.randomUUID(), [])

  useEffect(() => {
    mountTimeRef.current = Date.now()
    trackSubmissionFormOpened(source)
  }, [source])

  // Abandonment tracking via visibilitychange
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden' && !completed) {
        const elapsed = Math.round((Date.now() - mountTimeRef.current) / 1000)
        trackSubmissionFormAbandoned(lastStepRef.current, elapsed)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [completed])

  const fullSchema = useMemo(() => getFullSubmissionSchema(tSchema), [tSchema])

  const methods = useForm<SubmissionFormData>({
    resolver: zodResolver(fullSchema) as Resolver<SubmissionFormData>,
    defaultValues: {
      name: '',
      description: '',
      category: '',
      region: '',
      valueTags: [],
      logoUrl: '',
      productTypes: [],
      productTypeNote: '',
      productPhotos: [],
      brandHighlights: '',
      purchaseLinks: [{ platform: '', url: '' }],
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      retailLocations: [],
      pdpaConsent: false,
      turnstileToken: '',
      _honeypot: '',
    },
    mode: 'onTouched',
  })

  const handleUrlSuccess = useCallback(
    (data: ScrapedBrandData, links: UrlStepLinks) => {
      if (data.brandName) {
        methods.setValue('name', data.brandName)
      }
      if (data.description) {
        methods.setValue('description', data.description)
      }

      methods.setValue('socialLinks', {
        instagram: links.instagram || data.socialLinks.instagram || '',
        threads: links.threads || data.socialLinks.threads || '',
        facebook: links.facebook || data.socialLinks.facebook || '',
        website: links.websiteUrl || data.websiteUrl,
      })

      const validPurchaseLinks = links.purchaseLinks.filter(l => l.platform || l.url)
      if (validPurchaseLinks.length > 0) {
        methods.setValue('purchaseLinks', validPurchaseLinks)
      }

      setPhotos(mapScrapedToPhotos(data))
      setPhase('form')
    },
    [methods]
  )

  const handleUrlSkip = useCallback((links: UrlStepLinks) => {
    if (links.websiteUrl || links.instagram || links.threads || links.facebook) {
      methods.setValue('socialLinks', {
        instagram: links.instagram,
        threads: links.threads,
        facebook: links.facebook,
        website: links.websiteUrl,
      })
    }
    const validPurchaseLinks = links.purchaseLinks.filter(l => l.platform || l.url)
    if (validPurchaseLinks.length > 0) {
      methods.setValue('purchaseLinks', validPurchaseLinks)
    }
    setPhase('form')
  }, [methods])

  const handleNext = async () => {
    const schema = stepSchemas[currentStep]
    const currentValues = methods.getValues()

    const result = schema.safeParse(currentValues)
    if (!result.success) {
      await methods.trigger(STEP_FIELDS[currentStep])
      return
    }

    const nextStep = Math.min(currentStep + 1, STEP_COUNT - 1)
    setCurrentStep(nextStep)

    const stepName = SUBMISSION_STEP_NAMES[currentStep as keyof typeof SUBMISSION_STEP_NAMES]
    lastStepRef.current = stepName
    trackSubmissionFormStepCompleted(stepName)
  }

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0))
  }

  const handleEditStep = (stepIndex: number) => {
    setCurrentStep(stepIndex)
  }

  // eslint-disable-next-line react-hooks/refs
  const handleSubmit = methods.handleSubmit((data) => {
    setSubmitError(null)

    const photoUrls = photos.map((p) => p.url)
    const mergedData = {
      ...(data as SubmissionFormData),
      productTypes: (data as SubmissionFormData).productTypes ?? [],
      productTypeNote: (data as SubmissionFormData).productTypeNote ?? '',
      productPhotos: [...photoUrls, ...(data as SubmissionFormData).productPhotos.filter((url: string) => !photoUrls.includes(url))],
      isOwner,
      sourceAttribution,
    }

    startTransition(async () => {
      const result = await submitBrand(mergedData)
      if (result?.error) {
        setSubmitError(result.error)
      } else {
        setCompleted(true)
        const elapsed = Math.round((Date.now() - mountTimeRef.current) / 1000)
        trackSubmissionCompleted(
          data.name,
          data.category,
          Boolean(data.logoUrl),
          elapsed
        )
        router.push('/submit/confirmation')
      }
    })
  })

  const uploadPath = `brands/${sessionId}`

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <div className="text-center">
        <h1 className="font-heading text-[26px] font-bold text-foreground">
          {t('wizard.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('wizard.subheading')}
        </p>
      </div>

      {phase === 'url' ? (
        <div className="rounded-xl border border-border bg-white p-8 shadow-sm">
          <UrlStep
            onSuccess={handleUrlSuccess}
            onSkip={handleUrlSkip}
            isOwner={isOwner}
            onOwnerChange={setIsOwner}
            onAttributionChange={setSourceAttribution}
          />
        </div>
      ) : (
        <>
          <StepIndicator
            steps={[
              t('wizard.steps.brandInfo'),
              t('wizard.steps.products'),
              t('wizard.steps.links'),
              t('wizard.steps.review'),
            ]}
            currentStep={currentStep}
          />

          <FormProvider {...methods}>
            <form onSubmit={handleSubmit}>
              <div className="rounded-xl border border-border bg-white p-8 shadow-sm">
                {currentStep === 0 && (
                  <BrandInfoStep
                    categories={categories}
                    regionTags={regionTags}
                    valueTags={valueTags}
                    uploadPath={uploadPath}
                    photos={photos}
                    onPhotosChange={setPhotos}
                    isOwner={isOwner}
                    onNext={handleNext}
                  />
                )}
                {currentStep === 1 && (
                  <ProductsStep uploadPath={uploadPath} />
                )}
                {currentStep === 2 && <LinksStep />}
                {currentStep === 3 && (
                  <ReviewStep
                    onEditStep={handleEditStep}
                    regionTags={regionTags}
                    valueTags={valueTags}
                  />
                )}

                {submitError && (
                  <p className="mt-4 text-sm text-red-600">{submitError}</p>
                )}

                {/* Navigation */}
                <div className="mt-8 flex items-center justify-between">
                  {currentStep > 0 ? (
                    <button
                      type="button"
                      onClick={handleBack}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      {t('wizard.back')}
                    </button>
                  ) : (
                    <span />
                  )}

                  {currentStep > 0 && currentStep < STEP_COUNT - 1 ? (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cta px-5 py-2.5 text-sm font-medium text-cta-foreground hover:bg-cta/90"
                    >
                      {t('wizard.next')}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cta px-5 py-2.5 text-sm font-medium text-cta-foreground hover:bg-cta/90 disabled:opacity-50"
                    >
                      {isPending ? (
                        t('wizard.submitting')
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          {t('wizard.submitBrand')}
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </FormProvider>
        </>
      )}
    </div>
  )
}
