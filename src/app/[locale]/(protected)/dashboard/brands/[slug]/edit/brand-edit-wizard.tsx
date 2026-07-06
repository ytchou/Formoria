'use client'

import { useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { WizardSidebar } from '@/components/dashboard/wizard-sidebar'
import { WizardFooter } from '@/components/dashboard/wizard-footer'
import {
  brandEditSchema,
  brandPublishSchema,
  WIZARD_STEPS,
  SECTION_FIELDS,
  type BrandEditFormValues,
} from '@/lib/schemas/brand-edit'
import { saveSectionDraftAction } from '@/lib/actions/brand-edit-wizard'
import { publishDraftAction } from '@/app/[locale]/(protected)/dashboard/brands/[slug]/actions'
import type { Brand } from '@/lib/types'

import { DirtyFieldsContext } from './dirty-fields-context'

// Section components
import { BasicInfoSection } from './sections/basic-info-section'
import { MediaSection } from './sections/media-section'
import { LinksSection } from './sections/links-section'
import { LocationsSection } from './sections/locations-section'
import { ReputationSection } from './sections/reputation-section'

interface BrandEditWizardProps {
  brand: Brand
  defaultValues: Partial<BrandEditFormValues>
  initialStep?: number
  productTagSuggestions?: string[]
}

const SECTION_COMPONENTS = [
  MediaSection,
  LinksSection,
  LocationsSection,
  ReputationSection,
] as const

const FIELD_STEPS: Partial<Record<keyof BrandEditFormValues, number>> = {
  name: 0,
  productType: 0,
  description: 0,
  productTags: 0,
  priceRange: 0,
  heroImageUrl: 1,
  productPhotos: 1,
  purchaseWebsite: 2,
}

function deriveCompletedSteps(
  defaultValues: Partial<BrandEditFormValues>,
): Set<number> {
  const completed = new Set<number>()
  if (defaultValues.name) completed.add(0)
  if (defaultValues.heroImageUrl) {
    completed.add(1)
  }
  return completed
}

export function BrandEditWizard({
  brand,
  defaultValues,
  initialStep = 0,
  productTagSuggestions = [],
}: BrandEditWizardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations('dashboard.edit')

  const [activeStep, setActiveStep] = useState(initialStep)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() =>
    deriveCompletedSteps(defaultValues),
  )
  const [isSaving, setIsSaving] = useState(false)

  const form = useForm<BrandEditFormValues>({
    defaultValues: defaultValues as BrandEditFormValues,
    resolver: zodResolver(brandEditSchema),
  })

  const currentStepKey = WIZARD_STEPS[activeStep]?.key ?? 'basicInfo'
  const currentSectionFields = useMemo(
    () => SECTION_FIELDS[currentStepKey] ?? [],
    [currentStepKey],
  )

  const navigateTo = useCallback(
    (step: number) => {
      setActiveStep(step)
      const params = new URLSearchParams(searchParams.toString())
      params.set('step', String(step))
      router.replace(`${pathname}?${params.toString()}`)
    },
    [pathname, router, searchParams],
  )

  const handleSaveAndContinue = useCallback(async () => {
    const valid = await form.trigger(currentSectionFields)
    if (!valid) return

    setIsSaving(true)
    try {
      const sectionData = form.getValues()
      await saveSectionDraftAction(
        brand.id,
        brand.slug,
        currentStepKey,
        sectionData as Record<string, unknown>,
      )
      setCompletedSteps((prev) => new Set([...prev, activeStep]))
      if (activeStep < WIZARD_STEPS.length - 1) {
        navigateTo(activeStep + 1)
      }
    } finally {
      setIsSaving(false)
    }
  }, [
    form,
    currentSectionFields,
    currentStepKey,
    brand.id,
    brand.slug,
    activeStep,
    navigateTo,
  ])

  const handleSidebarClick = useCallback(
    async (targetStep: number) => {
      if (targetStep === activeStep) return
      const sectionData = form.getValues()
      const result = await saveSectionDraftAction(
        brand.id,
        brand.slug,
        currentStepKey,
        sectionData as Record<string, unknown>,
      )
      if (result.error) {
        toast.error(result.error)
        return
      }
      navigateTo(targetStep)
    },
    [activeStep, currentStepKey, brand.id, brand.slug, form, navigateTo],
  )

  const handleBack = useCallback(() => {
    if (activeStep > 0) navigateTo(activeStep - 1)
  }, [activeStep, navigateTo])

  const handleSaveDraft = useCallback(async () => {
    setIsSaving(true)
    try {
      const sectionData = form.getValues()
      await saveSectionDraftAction(
        brand.id,
        brand.slug,
        currentStepKey,
        sectionData as Record<string, unknown>,
      )
    } finally {
      setIsSaving(false)
    }
  }, [form, currentStepKey, brand.id, brand.slug])

  const handlePublish = useCallback(async () => {
    const result = brandPublishSchema.safeParse(form.getValues())
    if (!result.success) {
      const invalidFields = result.error.issues
        .map((issue) => issue.path.at(0))
        .filter(
          (field): field is keyof BrandEditFormValues =>
            typeof field === 'string',
        )
      for (const field of invalidFields) {
        form.setError(field, {
          type: 'required',
          message: t('requiredFieldError'),
        })
      }
      const firstField = invalidFields.at(0)
      if (firstField) {
        navigateTo(FIELD_STEPS[firstField] ?? 0)
        requestAnimationFrame(() => {
          const customTarget =
            firstField === 'heroImageUrl'
              ? document.getElementById('image-upload-heroImageUrl')
              : firstField === 'productPhotos'
                ? document.getElementById('productPhotos-upload')
                : null
          if (customTarget) customTarget.focus()
          else form.setFocus(firstField)
        })
      }
      return
    }

    setIsSaving(true)
    try {
      // Save current section first, then publish the accumulated draft
      const sectionData = form.getValues()
      await saveSectionDraftAction(
        brand.id,
        brand.slug,
        currentStepKey,
        sectionData as Record<string, unknown>,
      )
      const formData = new FormData()
      formData.set('brandSlug', brand.slug)
      await publishDraftAction(undefined, formData)
    } finally {
      setIsSaving(false)
    }
  }, [form, brand, currentStepKey, navigateTo, t])

  const SectionComponent =
    activeStep > 0 ? SECTION_COMPONENTS[activeStep - 1] : null
  const isDirty = form.formState.isDirty
  const dirtyFields = form.formState.dirtyFields

  return (
    <div className="flex gap-0 min-h-screen">
      <WizardSidebar
        steps={WIZARD_STEPS}
        activeStep={activeStep}
        completedSteps={completedSteps}
        onStepClick={handleSidebarClick}
      />
      <main className="flex-1 min-w-0 px-8 py-6 pb-32">
        <p className="mb-6 text-xs text-muted-foreground">
          <span aria-hidden="true" className="text-destructive">
            *
          </span>{' '}
          {t('requiredHint')}
        </p>
        <DirtyFieldsContext.Provider value={dirtyFields}>
          {activeStep === 0 ? (
            <BasicInfoSection
              form={form}
              productTagSuggestions={productTagSuggestions}
            />
          ) : (
            SectionComponent && <SectionComponent form={form} />
          )}
        </DirtyFieldsContext.Provider>
        <WizardFooter
          activeStep={activeStep}
          totalSteps={WIZARD_STEPS.length}
          isSaving={isSaving}
          isDirty={isDirty}
          onBack={handleBack}
          onSaveAndContinue={handleSaveAndContinue}
          onSaveDraft={handleSaveDraft}
          onPublish={handlePublish}
        />
      </main>
    </div>
  )
}
