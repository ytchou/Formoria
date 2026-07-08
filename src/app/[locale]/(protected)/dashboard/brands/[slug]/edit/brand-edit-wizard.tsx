'use client'

import { useState, useCallback, useMemo } from 'react'
import { usePathname } from 'next/navigation'
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
  initialCompletedSteps?: number[]
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

const STEP_VALIDATION_FIELDS: Partial<
  Record<string, (keyof BrandEditFormValues)[]>
> = {
  basicInfo: ['name', 'productType', 'description', 'priceRange'],
  links: ['purchaseWebsite'],
}

function deriveCompletedSteps(
  defaultValues: Partial<BrandEditFormValues>,
  initialCompletedSteps: number[] = [],
): Set<number> {
  const completed = new Set<number>(initialCompletedSteps)
  if (defaultValues.name) completed.add(0)
  if (defaultValues.heroImageUrl) {
    completed.add(1)
  }
  return completed
}

export function BrandEditWizard({
  brand,
  defaultValues,
  initialCompletedSteps = [],
  initialStep = 0,
  productTagSuggestions = [],
}: BrandEditWizardProps) {
  const pathname = usePathname()
  const t = useTranslations('dashboard.edit')

  const [activeStep, setActiveStep] = useState(initialStep)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() =>
    deriveCompletedSteps(defaultValues, initialCompletedSteps),
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
      const params = new URLSearchParams(window.location.search)
      params.set('step', String(step))
      window.history.replaceState(
        window.history.state,
        '',
        `${pathname}?${params.toString()}`,
      )
    },
    [pathname],
  )

  const markSectionSaved = useCallback(() => {
    for (const field of currentSectionFields) {
      form.resetField(field, { defaultValue: form.getValues(field) })
    }
  }, [currentSectionFields, form])

  const handleSaveAndContinue = useCallback(async () => {
    const validationFields = STEP_VALIDATION_FIELDS[currentStepKey] ?? []
    if (validationFields.length > 0) {
      const valid = await form.trigger(validationFields)
      if (!valid) return
    }

    if (
      currentStepKey === 'links' &&
      !form.getValues('purchaseWebsite')?.trim()
    ) {
      form.setError('purchaseWebsite', {
        type: 'required',
        message: t('requiredFieldError'),
      })
      form.setFocus('purchaseWebsite')
      return
    }

    setIsSaving(true)
    try {
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
      markSectionSaved()
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
    markSectionSaved,
    t,
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
      markSectionSaved()
      navigateTo(targetStep)
    },
    [activeStep, currentStepKey, brand.id, brand.slug, form, navigateTo, markSectionSaved],
  )

  const handleBack = useCallback(() => {
    if (activeStep > 0) navigateTo(activeStep - 1)
  }, [activeStep, navigateTo])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
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
      markSectionSaved()
    } finally {
      setIsSaving(false)
    }
  }, [form, currentStepKey, brand.id, brand.slug, markSectionSaved])

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
      // Save current section first, then publish the accumulated changes.
      const sectionData = form.getValues()
      const saveResult = await saveSectionDraftAction(
        brand.id,
        brand.slug,
        currentStepKey,
        sectionData as Record<string, unknown>,
      )
      if (saveResult.error) {
        toast.error(saveResult.error)
        return
      }
      markSectionSaved()
      const formData = new FormData()
      formData.set('brandSlug', brand.slug)
      const publishResult = await publishDraftAction(undefined, formData)
      if (publishResult?.error) {
        toast.error(publishResult.error)
      }
    } finally {
      setIsSaving(false)
    }
  }, [form, brand, currentStepKey, navigateTo, markSectionSaved, t])

  const SectionComponent =
    activeStep > 0 ? SECTION_COMPONENTS[activeStep - 1] : null
  const dirtyFields = form.formState.dirtyFields
  const isDirty = currentSectionFields.some((field) => Boolean(dirtyFields[field]))

  return (
    <div className="flex gap-0 min-h-screen">
      <WizardSidebar
        steps={WIZARD_STEPS}
        activeStep={activeStep}
        completedSteps={completedSteps}
        onStepClick={handleSidebarClick}
      />
      <main className="flex-1 min-w-0 px-8 py-6 pb-32">
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
          onSave={handleSave}
          onPublish={handlePublish}
        />
      </main>
    </div>
  )
}
