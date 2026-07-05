'use server'

import { createClient } from '@/lib/supabase/server'
import { getBrandDraft, saveDraft } from '@/lib/services/brands'
import { createPendingEdit } from '@/lib/services/pending-edits'
import { completeOnboardingStepsForSection } from '@/lib/services/brand-onboarding'
import { SECTION_TO_ONBOARDING_STEPS } from '@/lib/schemas/brand-edit'
import type { Brand } from '@/lib/types'

type SaveSectionDraftResult = {
  success?: true
  error?: string
}

export async function saveSectionDraftAction(
  brandId: string,
  sectionKey: string,
  sectionData: Record<string, unknown>
): Promise<SaveSectionDraftResult> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return { error: 'Unauthorized' }
    }

    const existingDraft = await getBrandDraft(brandId)
    const mergedData = {
      ...(existingDraft ?? {}),
      ...sectionData,
    }

    if (existingDraft) {
      await saveDraft(brandId, mergedData as Partial<Brand>)
    } else {
      await createPendingEdit(brandId, user.id, mergedData)
    }

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
