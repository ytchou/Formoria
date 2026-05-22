'use client'

import { useState, useMemo, useTransition, useEffect, useCallback } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Send } from 'lucide-react'
import { StepIndicator } from './StepIndicator'
import { UrlStep } from './UrlStep'
import { BrandInfoStep } from './BrandInfoStep'
import { ProductsStep } from './ProductsStep'
import { LinksStep } from './LinksStep'
import { ReviewStep } from './ReviewStep'
import {
  brandInfoSchema,
  productsSchema,
  linksSchema,
  reviewSchema,
  fullSubmissionSchema,
  type SubmissionFormData,
} from '@/lib/validations/submission'
import { submitBrand } from '@/app/submit/actions'
import {
  trackSubmissionStart,
  trackSubmissionStep,
  trackSubmissionComplete,
} from '@/lib/analytics'
import type { ScrapedBrandData, PhotoItem } from '@/lib/types/scraper'

const STEP_LABELS = ['Brand Info', 'Products', 'Links', 'Review']

const STEP_SCHEMAS = [brandInfoSchema, productsSchema, linksSchema, reviewSchema]

const STEP_FIELDS: (keyof SubmissionFormData)[][] = [
  ['name', 'description', 'category', 'tags', 'logoUrl'],
  ['productPhotos', 'productHighlights'],
  ['purchaseLinks', 'socialLinks', 'retailLocations'],
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

export function SubmitWizard({ categories }: SubmitWizardProps) {
  const router = useRouter()
  const [phase, setPhase] = useState<WizardPhase>('url')
  const [currentStep, setCurrentStep] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [photos, setPhotos] = useState<PhotoItem[]>([])

  const sessionId = useMemo(() => crypto.randomUUID(), [])

  useEffect(() => {
    trackSubmissionStart()
  }, [])

  const methods = useForm<SubmissionFormData>({
    resolver: zodResolver(fullSubmissionSchema),
    defaultValues: {
      name: '',
      description: '',
      category: '',
      tags: [],
      logoUrl: '',
      productPhotos: [],
      productHighlights: '',
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
    (data: ScrapedBrandData) => {
      // Pre-fill form with scraped data
      if (data.brandName) {
        methods.setValue('name', data.brandName)
      }
      if (data.description) {
        methods.setValue('description', data.description)
      }

      // Map social links
      methods.setValue('socialLinks', {
        instagram: data.socialLinks.instagram ?? '',
        threads: data.socialLinks.threads ?? '',
        facebook: data.socialLinks.facebook ?? '',
        website: data.websiteUrl,
      })

      // Map category hints to tags
      if (data.categoryHints.length > 0) {
        methods.setValue('tags', data.categoryHints.slice(0, 5))
      }

      // Map photos
      setPhotos(mapScrapedToPhotos(data))

      setPhase('form')
    },
    [methods]
  )

  const handleUrlSkip = useCallback(() => {
    setPhase('form')
  }, [])

  const handleNext = async () => {
    const schema = STEP_SCHEMAS[currentStep]
    const currentValues = methods.getValues()

    // Validate current step fields
    const result = schema.safeParse(currentValues)
    if (!result.success) {
      // Trigger validation display for only the current step's fields
      await methods.trigger(STEP_FIELDS[currentStep])
      return
    }

    const nextStep = Math.min(currentStep + 1, STEP_LABELS.length - 1)
    setCurrentStep(nextStep)
    trackSubmissionStep(nextStep + 1)
  }

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0))
  }

  const handleEditStep = (stepIndex: number) => {
    setCurrentStep(stepIndex)
  }

  const handleSubmit = methods.handleSubmit((data) => {
    setSubmitError(null)

    // Merge scraped photo URLs into productPhotos before submission
    const photoUrls = photos.map((p) => p.url)
    const mergedData = {
      ...data,
      productPhotos: [...photoUrls, ...data.productPhotos.filter((url) => !photoUrls.includes(url))],
    }

    startTransition(async () => {
      const result = await submitBrand(mergedData)
      if (result?.error) {
        setSubmitError(result.error)
      } else {
        trackSubmissionComplete()
        router.push('/submit/confirmation')
      }
    })
  })

  const uploadPath = `brands/${sessionId}`

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <div className="text-center">
        <h1 className="font-display text-[26px] font-bold text-[#1A1918]">
          Submit Your Brand
        </h1>
        <p className="mt-2 text-sm text-[#7C7570]">
          Share your Made in Taiwan brand with the community
        </p>
      </div>

      {phase === 'url' ? (
        <div className="rounded-xl border border-[#E8E5E0] bg-white p-8 shadow-sm">
          <UrlStep onSuccess={handleUrlSuccess} onSkip={handleUrlSkip} />
        </div>
      ) : (
        <>
          <StepIndicator steps={STEP_LABELS} currentStep={currentStep} />

          <FormProvider {...methods}>
            <form onSubmit={handleSubmit}>
              <div className="rounded-xl border border-[#E8E5E0] bg-white p-8 shadow-sm">
                {currentStep === 0 && (
                  <BrandInfoStep
                    categories={categories}
                    uploadPath={uploadPath}
                    photos={photos}
                    onPhotosChange={setPhotos}
                  />
                )}
                {currentStep === 1 && (
                  <ProductsStep uploadPath={uploadPath} />
                )}
                {currentStep === 2 && <LinksStep />}
                {currentStep === 3 && (
                  <ReviewStep onEditStep={handleEditStep} />
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
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4CFC9] bg-white px-5 py-2.5 text-sm font-medium text-[#1A1918] hover:bg-[#F5F4F1]"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </button>
                  ) : (
                    <span />
                  )}

                  {currentStep < STEP_LABELS.length - 1 ? (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33]"
                    >
                      Next
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33] disabled:opacity-50"
                    >
                      {isPending ? (
                        'Submitting...'
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          Submit Brand
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
