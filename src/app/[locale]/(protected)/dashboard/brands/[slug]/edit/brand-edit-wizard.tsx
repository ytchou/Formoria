'use client'

import { useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { WizardSidebar } from '@/components/dashboard/wizard-sidebar'
import { WizardFooter } from '@/components/dashboard/wizard-footer'
import {
  brandEditSchema,
  WIZARD_STEPS,
  SECTION_FIELDS,
  type BrandEditFormValues,
} from '@/lib/schemas/brand-edit'
import { saveSectionDraftAction } from '@/lib/actions/brand-edit-wizard'
import {
  publishDraftAction,
} from '@/app/[locale]/(protected)/dashboard/brands/[slug]/actions'
import type { Brand } from '@/lib/types'

// Section components
import { BasicInfoSection } from './sections/basic-info-section'
import { MediaSection } from './sections/media-section'
import { LinksSection } from './sections/links-section'
import { CustomerVoicesSection } from './sections/customer-voices-section'
import { LocationsSection } from './sections/locations-section'
import { ReputationSection } from './sections/reputation-section'
import { ManufacturingSection } from './sections/manufacturing-section'
import { CertificationsSection } from './sections/certifications-section'
import { PoliciesSection } from './sections/policies-section'

interface BrandEditWizardProps {
  brand: Brand
  defaultValues: Partial<BrandEditFormValues>
  initialStep?: number
  productTagSuggestions?: string[]
}

const SECTION_COMPONENTS = [
  MediaSection,
  LinksSection,
  CustomerVoicesSection,
  LocationsSection,
  ReputationSection,
  ManufacturingSection,
  CertificationsSection,
  PoliciesSection,
] as const

function deriveCompletedSteps(defaultValues: Partial<BrandEditFormValues>): Set<number> {
  const completed = new Set<number>()
  if (defaultValues.name) completed.add(0)
  if (
    defaultValues.heroImageUrl ||
    (defaultValues.productPhotos && defaultValues.productPhotos.length > 0)
  ) {
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

  const [activeStep, setActiveStep] = useState(initialStep)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() =>
    deriveCompletedSteps(defaultValues)
  )
  const [isSaving, setIsSaving] = useState(false)

  const form = useForm<BrandEditFormValues>({
    defaultValues: defaultValues as BrandEditFormValues,
    resolver: zodResolver(brandEditSchema),
  })

  const currentStepKey = WIZARD_STEPS[activeStep]?.key ?? 'basicInfo'
  const currentSectionFields = useMemo(
    () => SECTION_FIELDS[currentStepKey] ?? [],
    [currentStepKey]
  )

  const navigateTo = useCallback(
    (step: number) => {
      setActiveStep(step)
      const params = new URLSearchParams(searchParams.toString())
      params.set('step', String(step))
      router.replace(`${pathname}?${params.toString()}`)
    },
    [pathname, router, searchParams]
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
        sectionData as Record<string, unknown>
      )
      setCompletedSteps((prev) => new Set([...prev, activeStep]))
      if (activeStep < WIZARD_STEPS.length - 1) {
        navigateTo(activeStep + 1)
      }
    } finally {
      setIsSaving(false)
    }
  }, [form, currentSectionFields, currentStepKey, brand.id, brand.slug, activeStep, navigateTo])

  const handleSidebarClick = useCallback(
    async (targetStep: number) => {
      if (targetStep === activeStep) return
      const sectionData = form.getValues()
      const result = await saveSectionDraftAction(
        brand.id,
        brand.slug,
        currentStepKey,
        sectionData as Record<string, unknown>
      )
      if (result.error) {
        toast.error(result.error)
        return
      }
      navigateTo(targetStep)
    },
    [activeStep, currentStepKey, brand.id, brand.slug, form, navigateTo]
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
        sectionData as Record<string, unknown>
      )
    } finally {
      setIsSaving(false)
    }
  }, [form, currentStepKey, brand.id, brand.slug])

  const handlePublish = useCallback(async () => {
    const valid = await form.trigger()
    if (!valid) return

    setIsSaving(true)
    try {
      // Save current section first, then publish the accumulated draft
      const sectionData = form.getValues()
      await saveSectionDraftAction(
        brand.id,
        brand.slug,
        currentStepKey,
        sectionData as Record<string, unknown>
      )
      const formData = new FormData()
      formData.set('brandSlug', brand.slug)
      await publishDraftAction(undefined, formData)
    } finally {
      setIsSaving(false)
    }
  }, [form, brand, currentStepKey])

  const SectionComponent = activeStep > 0 ? SECTION_COMPONENTS[activeStep - 1] : null

  return (
    <div className="flex gap-0 min-h-screen">
      <WizardSidebar
        steps={WIZARD_STEPS}
        activeStep={activeStep}
        completedSteps={completedSteps}
        onStepClick={handleSidebarClick}
      />
      <main className="flex-1 min-w-0 px-8 py-6">
        {activeStep === 0 ? (
          <BasicInfoSection form={form} productTagSuggestions={productTagSuggestions} />
        ) : (
          SectionComponent && <SectionComponent form={form} />
        )}
        <WizardFooter
          activeStep={activeStep}
          totalSteps={WIZARD_STEPS.length}
          isSaving={isSaving}
          onBack={handleBack}
          onSaveAndContinue={handleSaveAndContinue}
          onSaveDraft={handleSaveDraft}
          onPublish={handlePublish}
        />
      </main>
    </div>
  )
}
