'use client'

import { useState, useMemo, useTransition } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Send } from 'lucide-react'
import { StepIndicator } from './StepIndicator'
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

const STEP_LABELS = ['Brand Info', 'Products', 'Links', 'Review']

const STEP_SCHEMAS = [brandInfoSchema, productsSchema, linksSchema, reviewSchema]

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

export function SubmitWizard({ categories }: SubmitWizardProps) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const sessionId = useMemo(() => crypto.randomUUID(), [])

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
    },
    mode: 'onTouched',
  })

  const handleNext = async () => {
    const schema = STEP_SCHEMAS[currentStep]
    const currentValues = methods.getValues()

    // Validate current step fields
    const result = schema.safeParse(currentValues)
    if (!result.success) {
      // Trigger validation display for the current step fields
      await methods.trigger()
      return
    }

    setCurrentStep((prev) => Math.min(prev + 1, STEP_LABELS.length - 1))
  }

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0))
  }

  const handleEditStep = (stepIndex: number) => {
    setCurrentStep(stepIndex)
  }

  const handleSubmit = methods.handleSubmit((data) => {
    setSubmitError(null)
    startTransition(async () => {
      const result = await submitBrand(data)
      if (result?.error) {
        setSubmitError(result.error)
      } else {
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

      <StepIndicator steps={STEP_LABELS} currentStep={currentStep} />

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit}>
          <div className="rounded-xl border border-[#E8E5E0] bg-white p-8 shadow-sm">
            {currentStep === 0 && (
              <BrandInfoStep
                categories={categories}
                uploadPath={uploadPath}
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
    </div>
  )
}
