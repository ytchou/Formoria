'use server'

import { createClient } from '@/lib/supabase/server'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { getBrandDraft, saveDraft } from '@/lib/services/brands'
import { completeOnboardingStepsForSection } from '@/lib/services/brand-onboarding'
import { SECTION_TO_ONBOARDING_STEPS } from '@/lib/schemas/brand-edit'
import type { Brand } from '@/lib/types'

type SaveSectionDraftResult = {
  success?: true
  error?: string
}

export async function saveSectionDraftAction(
  brandId: string,
  brandSlug: string,
  sectionKey: string,
  sectionData: Record<string, unknown>
): Promise<SaveSectionDraftResult>
export async function saveSectionDraftAction(
  brandId: string,
  sectionKey: string,
  sectionData: Record<string, unknown>
): Promise<SaveSectionDraftResult>
export async function saveSectionDraftAction(
  brandId: string,
  brandSlugOrSectionKey: string,
  sectionKeyOrSectionData: string | Record<string, unknown>,
  sectionData?: Record<string, unknown>
): Promise<SaveSectionDraftResult> {
  try {
    if (typeof sectionKeyOrSectionData !== 'string' || !sectionData) {
      return { error: 'Unauthorized' }
    }

    const brandSlug = brandSlugOrSectionKey
    const sectionKey = sectionKeyOrSectionData

    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return { error: 'Unauthorized' }
    }

    const editor = await requireBrandEditor(brandSlug)
    if ('error' in editor || editor.brand.id !== brandId) {
      return { error: 'Unauthorized' }
    }

    const existingDraft = await getBrandDraft(brandId)
    const mergedData = {
      ...(existingDraft ?? {}),
      ...sectionData,
    }

    await saveDraft(brandId, mergedData as Partial<Brand>)

    if (SECTION_TO_ONBOARDING_STEPS[sectionKey]?.length) {
      await completeOnboardingStepsForSection(brandId, sectionKey)
    }

    return { success: true }
  } catch (error) {
    console.error('[brand-edit-wizard:saveSectionDraftAction]', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to save draft',
    }
  }
}
