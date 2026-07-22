'use client'

import { useState, useCallback, useMemo } from 'react'
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
import { useWizardController } from '@/components/brand-wizard/use-wizard-controller'
import type { ContentViolation } from '@/lib/services/moderation'
import type { Brand } from '@/lib/types'

import { DirtyFieldsContext } from '@/components/brand-wizard/dirty-fields-context'

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

const SCAN_FIELD_TO_FORM_FIELD: Record<string, keyof BrandEditFormValues> = {
  website: 'purchaseWebsite',
  purchaseUrl: 'purchaseWebsite',
}

const MODERATION_MESSAGE_KEYS: Record<string, string> = {
  suspicious_tld: 'moderation.suspiciousTld',
  excessive_urls: 'moderation.excessiveUrls',
  english_spam: 'moderation.englishSpam',
  contact_injection_phone: 'moderation.contactInjectionPhone',
  contact_injection_email: 'moderation.contactInjectionEmail',
  excessive_emoji: 'moderation.excessiveEmoji',
  short_description: 'moderation.shortDescription',
  identical_description: 'moderation.identicalDescription',
}

const STEP_VALIDATION_FIELDS: Partial<
  Record<string, (keyof BrandEditFormValues)[]>
> = {
  basicInfo: ['name', 'productType', 'description', 'priceRange'],
  links: ['purchaseWebsite'],
  locations: ['retailLocations'],
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
  const t = useTranslations('dashboard.edit')
  const [isSaving, setIsSaving] = useState(false)

  const form = useForm<BrandEditFormValues>({
    defaultValues: defaultValues as BrandEditFormValues,
    resolver: zodResolver(brandEditSchema),
  })

  const markSectionSaved = useCallback((stepKey: string) => {
    for (const field of SECTION_FIELDS[stepKey] ?? []) {
      form.resetField(field, { defaultValue: form.getValues(field) })
    }
  }, [form])

  const validateStep = useCallback(async (stepKey: string) => {
    const validationFields = STEP_VALIDATION_FIELDS[stepKey] ?? []
    if (validationFields.length > 0) {
      const valid = await form.trigger(validationFields)
      if (!valid) return false
    }

    if (
      stepKey === 'links' &&
      !form.getValues('purchaseWebsite')?.trim()
    ) {
      form.setError('purchaseWebsite', {
        type: 'required',
        message: t('requiredFieldError'),
      })
      form.setFocus('purchaseWebsite')
      return false
    }

    return true
  }, [form, t])

  const persistStepDraft = useCallback(async (stepKey: string) => {
    const sectionData = form.getValues()
    const result = await saveSectionDraftAction(
      brand.id,
      brand.slug,
      stepKey,
      sectionData as Record<string, unknown>,
    )
    if (result.error) {
      toast.error(result.error)
      return false
    }
    markSectionSaved(stepKey)
    return true
  }, [brand.id, brand.slug, form, markSectionSaved])

  const saveStepDraft = useCallback(async (stepKey: string) => {
    setIsSaving(true)
    try {
      return await persistStepDraft(stepKey)
    } finally {
      setIsSaving(false)
    }
  }, [persistStepDraft])

  const {
    activeStep,
    completedSteps,
    currentStepKey,
    navigateTo,
    goToStep,
    continueToNext,
    goBack,
  } = useWizardController({
    steps: WIZARD_STEPS,
    initialStep,
    initialCompletedSteps: deriveCompletedSteps(
      defaultValues,
      initialCompletedSteps,
    ),
    validateStep,
    beforeStepChange: saveStepDraft,
  })

  const currentSectionFields = useMemo(
    () => SECTION_FIELDS[currentStepKey] ?? [],
    [currentStepKey],
  )

  const handleSave = useCallback(async () => {
    await saveStepDraft(currentStepKey)
  }, [currentStepKey, saveStepDraft])

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
      if (!(await persistStepDraft(currentStepKey))) return
      const formData = new FormData()
      formData.set('brandSlug', brand.slug)
      const publishResult = await publishDraftAction(undefined, formData)
      if (publishResult?.violations && publishResult.violations.length > 0) {
        for (const violation of publishResult.violations as ContentViolation[]) {
          const formField = SCAN_FIELD_TO_FORM_FIELD[violation.field] ?? violation.field as keyof BrandEditFormValues
          form.setError(formField, {
            type: 'server',
            message:
              MODERATION_MESSAGE_KEYS[violation.rule] &&
              t.has(MODERATION_MESSAGE_KEYS[violation.rule])
                ? t(MODERATION_MESSAGE_KEYS[violation.rule])
                : violation.userMessage,
          })
        }
        const firstViolation = publishResult.violations[0]
        const firstField = SCAN_FIELD_TO_FORM_FIELD[firstViolation.field] ?? firstViolation.field as keyof BrandEditFormValues
        if (firstField && FIELD_STEPS[firstField] !== undefined) {
          navigateTo(FIELD_STEPS[firstField]!)
        }
        toast.error(t('violationSummary'))
        return
      }
      if (publishResult?.error) {
        toast.error(publishResult.error)
      }
    } finally {
      setIsSaving(false)
    }
  }, [form, brand.slug, currentStepKey, navigateTo, persistStepDraft, t])

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
        onStepClick={(targetStep) => void goToStep(targetStep)}
      />
      <main className="flex-1 min-w-0 px-8 py-6 pb-32">
        <DirtyFieldsContext.Provider value={dirtyFields}>
          {activeStep === 0 ? (
            <BasicInfoSection
              form={form}
              productTagSuggestions={productTagSuggestions}
              currentSlug={brand.slug}
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
          onBack={goBack}
          onSaveAndContinue={() => void continueToNext()}
          onSave={handleSave}
          onPublish={handlePublish}
        />
      </main>
    </div>
  )
}
